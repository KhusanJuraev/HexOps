"""The encrypted .hexops container (format version 1, D-90).

    magic      8 bytes   b"HEXOPS\\x00\\x01"
    length     4 bytes   big-endian length of the header
    header     JSON      KDF parameters, cipher, chunk size, nonce prefix, key check
    chunks     repeated  4-byte big-endian length, then AES-256-GCM ciphertext + tag

- The key is Argon2id(passphrase, salt) — 64 MiB, 3 passes, 2 lanes, 32 bytes. The
  passphrase itself is never written anywhere.
- Each chunk (1 MiB of plaintext) is sealed with nonce = prefix(7) ‖ counter(4) ‖
  last(1) and the magic + header as associated data (the STREAM construction): a
  changed, reordered, dropped or appended chunk, a truncated file or an edited
  header all fail authentication.
- `check` is a known value sealed with the key, so a wrong passphrase is told apart
  from a damaged file.
"""

import base64
import json
import os
import struct
from collections.abc import Iterator
from typing import BinaryIO

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"HEXOPS\x00\x01"
CHUNK = 1024 * 1024
_MAX_HEADER = 4096
_CHECK_PLAIN = b"hexops key check v1"
_KDF = {"name": "argon2id", "time_cost": 3, "memory_kib": 65536, "parallelism": 2}


class ContainerError(Exception):
    """code: transfer_not_hexops | transfer_wrong_passphrase | transfer_corrupt."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _derive(passphrase: str, salt: bytes, kdf: dict) -> bytes:
    if kdf.get("name") != "argon2id":
        raise ContainerError("transfer_corrupt")
    # Bounds keep a crafted header from asking for absurd work or memory.
    t, m, p = int(kdf["time_cost"]), int(kdf["memory_kib"]), int(kdf["parallelism"])
    if not (1 <= t <= 10 and 8 * p <= m <= 1024 * 1024 and 1 <= p <= 16):
        raise ContainerError("transfer_corrupt")
    return hash_secret_raw(
        passphrase.encode("utf-8"),
        salt,
        time_cost=t,
        memory_cost=m,
        parallelism=p,
        hash_len=32,
        type=Type.ID,
    )


def _nonce(prefix: bytes, counter: int, last: bool) -> bytes:
    return prefix + struct.pack(">I", counter) + (b"\x01" if last else b"\x00")


class EncryptingWriter:
    """A write-only, non-seekable file object; zipfile writes the archive into it."""

    def __init__(self, out: BinaryIO, passphrase: str) -> None:
        salt, prefix = os.urandom(16), os.urandom(7)
        self._aead = AESGCM(_derive(passphrase, salt, _KDF))
        check_nonce = prefix + b"\xff\xff\xff\xff\x02"
        header = json.dumps(
            {
                "kdf": {**_KDF, "salt": base64.b64encode(salt).decode()},
                "cipher": "AES-256-GCM",
                "chunk_size": CHUNK,
                "nonce_prefix": base64.b64encode(prefix).decode(),
                "check": base64.b64encode(
                    self._aead.encrypt(check_nonce, _CHECK_PLAIN, None)
                ).decode(),
            },
            sort_keys=True,
        ).encode()
        self._aad = MAGIC + struct.pack(">I", len(header)) + header
        self._out, self._prefix = out, prefix
        self._buffer = bytearray()
        self._counter = 0
        self.bytes_out = 0
        out.write(self._aad)

    def _seal(self, data: bytes, last: bool) -> None:
        sealed = self._aead.encrypt(_nonce(self._prefix, self._counter, last), data, self._aad)
        self._out.write(struct.pack(">I", len(sealed)) + sealed)
        self.bytes_out += 4 + len(sealed)
        self._counter += 1

    def write(self, data: bytes) -> int:
        self._buffer += data
        while len(self._buffer) > CHUNK:  # keep at least one byte for the final chunk
            self._seal(bytes(self._buffer[:CHUNK]), last=False)
            del self._buffer[:CHUNK]
        return len(data)

    def tell(self) -> int:  # zipfile then treats the stream as unseekable
        raise OSError("not seekable")

    def flush(self) -> None:
        self._out.flush()

    def close(self) -> None:
        """Seal the last chunk (flagged final). Must be called exactly once."""
        self._seal(bytes(self._buffer), last=True)
        self._buffer.clear()
        self._out.flush()


def _read_exact(src: BinaryIO, n: int) -> bytes:
    data = src.read(n)
    if len(data) != n:
        raise ContainerError("transfer_corrupt")
    return data


def open_container(src: BinaryIO, passphrase: str) -> Iterator[bytes]:
    """Yield the plaintext in chunks after checking the passphrase.

    Raises ContainerError before yielding anything if the file is not a .hexops
    container or the passphrase is wrong; while iterating, if any chunk was altered,
    reordered, dropped, or the file was cut short.
    """
    if src.read(len(MAGIC)) != MAGIC:
        raise ContainerError("transfer_not_hexops")
    raw_len = _read_exact(src, 4)
    (length,) = struct.unpack(">I", raw_len)
    if not 0 < length <= _MAX_HEADER:
        raise ContainerError("transfer_corrupt")
    header_bytes = _read_exact(src, length)
    try:
        header = json.loads(header_bytes)
        salt = base64.b64decode(header["kdf"]["salt"], validate=True)
        prefix = base64.b64decode(header["nonce_prefix"], validate=True)
        check = base64.b64decode(header["check"], validate=True)
        if header["cipher"] != "AES-256-GCM" or len(salt) != 16 or len(prefix) != 7:
            raise ValueError
        chunk_size = int(header["chunk_size"])
        if not 1024 <= chunk_size <= 16 * CHUNK:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        raise ContainerError("transfer_corrupt") from None
    aead = AESGCM(_derive(passphrase, salt, header["kdf"]))
    try:
        aead.decrypt(prefix + b"\xff\xff\xff\xff\x02", check, None)
    except InvalidTag:
        raise ContainerError("transfer_wrong_passphrase") from None
    return _chunks(src, aead, prefix, MAGIC + raw_len + header_bytes, chunk_size)


def _chunks(
    src: BinaryIO, aead: AESGCM, prefix: bytes, aad: bytes, chunk_size: int
) -> Iterator[bytes]:
    counter = 0
    while True:
        raw = src.read(4)
        if len(raw) != 4:
            raise ContainerError("transfer_corrupt")  # ended before the final chunk
        (length,) = struct.unpack(">I", raw)
        if not 16 <= length <= chunk_size + 16:
            raise ContainerError("transfer_corrupt")
        sealed = _read_exact(src, length)
        for last in (False, True):
            try:
                plain = aead.decrypt(_nonce(prefix, counter, last), sealed, aad)
            except InvalidTag:
                continue
            break
        else:
            raise ContainerError("transfer_corrupt")
        counter += 1
        yield plain
        if last:
            if src.read(1):
                raise ContainerError("transfer_corrupt")  # data after the final chunk
            return

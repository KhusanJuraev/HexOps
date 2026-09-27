"""CVSS vector syntax checks. Scores are never derived from vectors here (D-61)."""

import re

_EXTRA = r"(?:/[A-Za-z]{1,4}:[A-Za-z]{1,2})*"
_V3 = re.compile(
    r"^CVSS:3\.[01]/AV:[NALP]/AC:[LH]/PR:[NLH]/UI:[NR]/S:[UC]/C:[NLH]/I:[NLH]/A:[NLH]"
    + _EXTRA
    + "$"
)
_V4 = re.compile(
    r"^CVSS:4\.0/AV:[NALP]/AC:[LH]/AT:[NP]/PR:[NLH]/UI:[NPA]"
    r"/VC:[HLN]/VI:[HLN]/VA:[HLN]/SC:[HLN]/SI:[HLN]/SA:[HLN]" + _EXTRA + "$"
)


def is_valid_vector(vector: str) -> bool:
    return bool(_V3.match(vector) or _V4.match(vector))

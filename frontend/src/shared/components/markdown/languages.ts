// A curated set of grammars for fenced code blocks: what security write-ups use,
// without shipping all ~190 highlight.js languages.
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import http from 'highlight.js/lib/languages/http'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import nginx from 'highlight.js/lib/languages/nginx'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  diff,
  dockerfile,
  go,
  http,
  ini,
  java,
  javascript,
  json,
  nginx,
  php,
  plaintext,
  powershell,
  python,
  ruby,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
}

// Common fence names mapped to a grammar above (```sh, ```html, ```py …).
export const ALIASES: Record<string, string[]> = {
  bash: ['sh', 'zsh'],
  javascript: ['js', 'jsx'],
  typescript: ['ts', 'tsx'],
  python: ['py'],
  xml: ['html', 'svg'],
  yaml: ['yml'],
  powershell: ['ps1', 'ps'],
  plaintext: ['text', 'txt'],
  shell: ['console'],
}

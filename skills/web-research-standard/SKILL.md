---
name: web-research-standard
description: "Research the web to a quality standard: programmatic search first, synthesize sources, cite URLs, and extract result pages — never browse a search-engine results page."
allowed_tools: ["web.search", "web.batch_search", "web.extract_page", "web.open_result", "web.extract_contact_info", "web.verify_source", "ask_user"]
requires_connections: []
risk: "external_read"
trigger: "search internet web research latest news current sources keres interneten utananez forras hir cite"
when_to_use: ["Use when the user asks to search the internet, get latest info, current news, or web-sourced facts."]
when_not_to_use: ["Do not use to interact with one specific known web app (use browser-automation)."]
---

# Web Research Standard

Use this skill for internet lookup and research-grade answers from web sources.

## Tool order
1. A known service with a connection/API → use that first.
2. Otherwise `web.search` / `web.batch_search`. NEVER open a search-engine results page with `browser.open`.
3. `web.extract_page` on the most relevant result URLs so the answer is based on page content, not titles.
4. `browser.open` only for a specific source URL that needs interactive viewing.

## Output quality
- If no search provider is configured, stop with `ask_user`/blocking explanation — do not browse as a human substitute.
- A web-backed answer must SYNTHESIZE sources: start with the direct answer, then evidence, dates/freshness, uncertainty, and practical implications.
- Prefer primary/reference sources. If sources are weak, stale, or conflicting, say so explicitly — do not hide uncertainty.
- Cite source URLs in factual summaries with enough detail for the user to trust what was found and what remains unknown.

## Action shapes (exact JSON)
{"action":"web.search","query":"<search query>","locale":"<optional>","country":"<optional>","maxResults":5,"depth":"quick"}
{"action":"web.batch_search","queries":["<q1>","<q2>"],"concurrency":4,"maxResultsPerQuery":5,"locale":"<optional>","country":"<optional>"}
{"action":"web.open_result","url":"<selected result URL>"}
{"action":"web.extract_page","url":"<selected result URL>","maxChars":12000}
{"action":"web.extract_contact_info","url":"<source URL>","text":"<optional extracted text>"}
{"action":"web.verify_source","url":"<source URL>","claim":"<optional claim>","expectedDomain":"<optional domain>"}

## Verification
- Ground every factual claim in an extracted/cited source; flag low-confidence or conflicting findings.

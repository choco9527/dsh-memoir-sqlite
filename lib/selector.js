/**
 * Hot memory selector (roadmap §2.3) — picks the highest-value memory for
 * system-prompt injection under a token budget, and renders it compactly.
 *
 * Deterministic: fixed entries + budget always produce the same text (a
 * requirement for stable prompt prefixes). No ids / sessionIds / timestamps /
 * repeated section labels in the injected text — those burn tokens without
 * changing behavior.
 */
import { hostCopy } from './i18n.js';
import { DEFAULT_MEMOIR_SETTINGS } from './settings.js';
/** Defaults (roadmap §2.3 / config hotMemoryTokens / hotMemoryMaxTokens). */
export const DEFAULT_MEMORY_BUDGET = {
    targetTokens: DEFAULT_MEMOIR_SETTINGS.hotMemoryTokens,
    hardMaxTokens: DEFAULT_MEMOIR_SETTINGS.hotMemoryMaxTokens,
};
/** Section weights for the v0.4 scoring (roadmap §2.3). */
export const SECTION_WEIGHTS = {
    actions: 4.0,
    lessons: 3.5,
    work: 2.0,
    note: 0.5,
};
/** Canonical long-term section order; work and note are query-only. */
export const HOT_SECTION_ORDER = ['actions', 'lessons'];
/** CJK-ish codepoint ranges counted as ~1 token each. */
function isCjk(cp) {
    return ((cp >= 0x3000 && cp <= 0x303f) || // CJK punctuation
        (cp >= 0x3040 && cp <= 0x30ff) || // kana
        (cp >= 0x3400 && cp <= 0x9fff) || // CJK ideographs
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat
        (cp >= 0xff00 && cp <= 0xffef) || // fullwidth forms
        (cp >= 0xac00 && cp <= 0xd7af) // hangul
    );
}
/**
 * Conservative token approximation without a tokenizer library (roadmap
 * §2.3): CJK chars ≈ 1 token each, everything else ≈ 4 chars/token.
 */
export function estimateTokens(text) {
    let cjk = 0;
    let other = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (isCjk(cp))
            cjk++;
        else
            other++;
    }
    return Math.ceil(cjk + other / 4);
}
/** Recency decay: 1.0 now → ~0 toward very old entries. */
function recencyBoost(time, now) {
    const ageDays = Math.max(0, now - time) / 86_400_000;
    return 1.0 / (1 + ageDays / 30);
}
/**
 * Score + order candidates deterministically:
 * section weight + recency decay; ties break by newer time, then id.
 * note entries are excluded by default (roadmap §1.2 B: notes never enter
 * hot memory in v0.4).
 */
export function rankEntries(entries, now = Date.now()) {
    return entries
        .filter((e) => e.section !== 'note' && (e.status ?? 'active') === 'active')
        .map((entry) => ({
        entry,
        score: SECTION_WEIGHTS[entry.section] + recencyBoost(entry.time, now) + (entry.importance ?? 3) * 0.2 + (entry.pinned === true ? 2.5 : 0),
    }))
        .sort((a, b) => b.score - a.score || b.entry.time - a.entry.time || a.entry.id.localeCompare(b.entry.id));
}
/** Compact bullet for one entry: title prefix + content (no ids/timestamps). */
export function compactLine(entry, language) {
    const separator = language === 'en' ? ': ' : '：';
    const head = entry.title !== undefined && entry.title !== '' ? entry.title + separator : '';
    return '- ' + head + entry.content.replace(/\s+/g, ' ').trim();
}
/** The injected header line. */
export const HOT_MEMORY_HEADER = '[Project memory]';
/**
 * Render long-term actions and lessons; work records remain query-only.
 */
export function renderHotMemory(selected, language) {
    // Undefined preserves the pre-v0.6 helper output for source consumers;
    // the plugin itself always supplies its live agent language.
    const copy = language === undefined ? undefined : hostCopy(language).hotMemory;
    const lines = [copy?.header ?? HOT_MEMORY_HEADER];
    for (const section of HOT_SECTION_ORDER) {
        const group = selected.filter((e) => e.section === section);
        if (group.length === 0)
            continue;
        const label = section === 'actions' ? (copy?.actions ?? 'Actions:') : (copy?.lessons ?? 'Lessons:');
        lines.push(label);
        for (const entry of group)
            lines.push(compactLine(entry, language));
        lines.push('');
    }
    return lines.join('\n').replace(/\n\n\n+/g, '\n\n').trim();
}
/**
 * Truncate one entry's content so the rendered single-entry block fits the
 * hard token ceiling. Binary-searches the largest fitting code-point length
 * (monotone in the token estimate). Used only for the degenerate case of an
 * oversized FIRST candidate — normal selection never exceeds hardMax.
 */
export function truncateEntryToBudget(entry, hardMaxTokens, language) {
    if (estimateTokens(renderHotMemory([entry], language)) <= hardMaxTokens)
        return entry;
    const cps = [...entry.content];
    let lo = 0;
    let hi = cps.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const probe = { ...entry, content: cps.slice(0, mid).join('') + '…' };
        if (estimateTokens(renderHotMemory([probe], language)) <= hardMaxTokens)
            lo = mid;
        else
            hi = mid - 1;
    }
    return { ...entry, content: cps.slice(0, lo).join('') + '…' };
}
/**
 * Select ranked actions then lessons under the budget.
 * Work records and notes are available only through explicit retrieval.
 * Each candidate is added while the rendered estimate stays below
 * targetTokens; hardMaxTokens is never exceeded (an oversized first
 * candidate is truncated into place via truncateEntryToBudget).
 *
 * @param entries - one project's entries.
 * @param budget - token budget (defaults to DEFAULT_MEMORY_BUDGET).
 * @param now - clock for recency (injectable for deterministic tests).
 */
export function selectHotMemory(entries, budget = DEFAULT_MEMORY_BUDGET, now = Date.now(), language) {
    const actions = rankEntries(entries.filter((e) => e.section === 'actions'), now).map((s) => s.entry);
    const lessons = rankEntries(entries.filter((e) => e.section === 'lessons'), now).map((s) => s.entry);
    const candidates = [...actions, ...lessons];
    const selected = [];
    const selectedIds = new Set();
    for (const entry of candidates) {
        if (selectedIds.has(entry.id))
            continue;
        const probe = selected.length === 0 ? [entry] : [...selected, entry];
        const tokens = estimateTokens(renderHotMemory(probe, language));
        if (tokens > budget.hardMaxTokens) {
            if (selected.length === 0) {
                // A single oversized entry: force it in truncated so output stays
                // bounded and non-empty.
                selected.push(truncateEntryToBudget(entry, budget.hardMaxTokens, language));
            }
            break;
        }
        selected.push(entry);
        selectedIds.add(entry.id);
        if (tokens >= budget.targetTokens)
            break;
    }
    const text = selected.length === 0 ? '' : renderHotMemory(selected, language);
    return {
        text,
        selected,
        total: candidates.length,
        estimatedTokens: estimateTokens(text),
    };
}

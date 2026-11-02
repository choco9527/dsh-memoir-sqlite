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
 * Fit one entry's rendered block to the hard ceiling without changing the
 * original. Shorten content first, then the title when necessary. Return
 * undefined if even the localized headings and a title-free ellipsis cannot fit.
 */
export function truncateEntryToBudget(entry, hardMaxTokens, language) {
    const fits = (probe) => estimateTokens(renderHotMemory([probe], language)) <= hardMaxTokens;
    if (fits(entry))
        return entry;
    function fitPrefix(field, base) {
        const cps = [...(entry[field] ?? '')];
        let result = base;
        let lo = 1;
        let hi = cps.length;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const probe = { ...base, [field]: cps.slice(0, mid).join('') + '…' };
            if (fits(probe)) {
                result = probe;
                lo = mid + 1;
            }
            else
                hi = mid - 1;
        }
        return result;
    }
    const minimalContent = { ...entry, content: '…' };
    if (fits(minimalContent))
        return fitPrefix('content', minimalContent);
    const minimalBlock = { ...minimalContent, title: undefined };
    if (!fits(minimalBlock))
        return undefined;
    return fitPrefix('content', fitPrefix('title', minimalBlock));
}
/**
 * Select ranked actions then lessons under the budget.
 * Work records and notes are available only through explicit retrieval.
 * Skip candidates that exceed the remaining hard budget and keep scanning
 * for smaller entries. Stop when an accepted entry reaches targetTokens.
 * Truncate an oversized first entry only when its minimal block fits.
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
        let candidate = entry;
        let tokens = estimateTokens(renderHotMemory(probe, language));
        if (tokens > budget.hardMaxTokens) {
            if (selected.length > 0)
                continue;
            const truncated = truncateEntryToBudget(entry, budget.hardMaxTokens, language);
            if (truncated === undefined)
                continue;
            candidate = truncated;
            tokens = estimateTokens(renderHotMemory([candidate], language));
        }
        selected.push(candidate);
        selectedIds.add(candidate.id);
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

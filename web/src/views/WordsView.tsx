import { useEffect, useMemo, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { resolvedNounForms, type NounMorphology } from "../cards/nounMorphology";
import { nounFormPhrases } from "../cards/nounDraft";
import { cardTypes, typeLabels } from "../cardTypes";
import { italianHeadword } from "../components/CardAnswer";
import { InventoryCardsEditor } from "../components/CardEditors";
import { Icon } from "../components/Icons";

export type WordsTypeFilter = CardType | "all";

function secondaryForms(card: Flashcard, morphology: NounMorphology) {
  try {
    if (card.type === "noun") {
      const phrases = nounFormPhrases(resolvedNounForms(card, morphology));
      return phrases.length ? phrases.map((phrase) => phrase.text).join(" · ") : "no articles";
    }
    if (card.type === "verb") return `${card.details.io}, ${card.details.tu}… · ${card.details.auxiliary} ${card.details.participle}`;
    if (card.type === "adjective") return [card.details.feminineSingular, card.details.masculinePlural, card.details.femininePlural].join(" · ");
    return "invariant";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid noun definition";
  }
}

function FilterRail({
  sets,
  tags,
  selected,
  onToggle,
  onClear,
  onRemoveTag,
}: {
  sets: [string, number][];
  tags: [string, number][];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  const [editingTags, setEditingTags] = useState(false);
  return <div className="filter-rail">
    <div className="filter-section">
      <div className="filter-heading"><h3>Sets</h3>{selected.length > 0 && <button type="button" className="text-button small" onClick={onClear}>Clear filters</button>}</div>
      {sets.length ? <ul>{sets.map(([name, count]) => {
        const key = `set:${name}`;
        return <li key={key}><button type="button" className={`filter-item ${selected.includes(key) ? "selected" : ""}`} aria-pressed={selected.includes(key)} onClick={() => onToggle(key)}><Icon name="folder" size={15} /><span>{name}</span><small>{count}</small></button></li>;
      })}</ul> : <p className="filter-empty">No sets yet</p>}
    </div>
    <div className="filter-section">
      <div className="filter-heading"><h3>Tags</h3>{tags.length > 0 && <button type="button" className="text-button small" onClick={() => setEditingTags((value) => !value)}>{editingTags ? "Done" : "Manage"}</button>}</div>
      {tags.length ? <ul>{tags.map(([tag, count]) => {
        const key = `tag:${tag}`;
        return <li key={key} className="filter-tag-row">
          <button type="button" className={`filter-item ${selected.includes(key) ? "selected" : ""}`} aria-pressed={selected.includes(key)} onClick={() => onToggle(key)}><span className="hash">#</span><span>{tag}</span><small>{count}</small></button>
          {editingTags && <button type="button" className="icon-button danger" onClick={() => onRemoveTag(tag)} aria-label={`Remove tag ${tag} from all words`} title="Remove from all words"><Icon name="trash" size={15} /></button>}
        </li>;
      })}</ul> : <p className="filter-empty">No tags yet</p>}
    </div>
  </div>;
}

function BulkBar({ count, knownSets, onTag, onSet, onDelete, onClear }: { count: number; knownSets: string[]; onTag: (tag: string) => void; onSet: (set: string | null) => void; onDelete: () => void; onClear: () => void }) {
  const [mode, setMode] = useState<"tag" | "set" | null>(null);
  const [value, setValue] = useState("");

  function apply() {
    const trimmed = value.trim();
    if (mode === "tag" && trimmed) onTag(trimmed);
    if (mode === "set") onSet(trimmed || null);
    setMode(null);
    setValue("");
  }

  return <div className="bulk-bar" role="region" aria-label="Selected words">
    <span className="bulk-count">{count} selected</span>
    {mode ? <form className="bulk-input" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} list={mode === "set" ? "bulk-known-sets" : undefined} placeholder={mode === "tag" ? "Tag name" : "Set name (empty removes)"} aria-label={mode === "tag" ? "Tag to add" : "Set to move to"} />
      <datalist id="bulk-known-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
      <button type="submit" className="primary-button small" disabled={mode === "tag" && !value.trim()}>{mode === "tag" ? "Add tag" : "Move"}</button>
      <button type="button" className="text-button small" onClick={() => { setMode(null); setValue(""); }}>Cancel</button>
    </form> : <>
      <button type="button" className="neutral-button small" onClick={() => setMode("tag")}><Icon name="tag" size={15} /> Add tag</button>
      <button type="button" className="neutral-button small" onClick={() => setMode("set")}><Icon name="folder" size={15} /> Move to set</button>
      <button type="button" className="neutral-button small danger" onClick={onDelete}><Icon name="trash" size={15} /> Delete</button>
      <button type="button" className="text-button small" onClick={onClear}>Clear</button>
    </>}
  </div>;
}

export function WordsView({
  loading,
  warning,
  cards,
  matchingCards,
  filteredCards,
  morphology,
  knownSets,
  query,
  onQuery,
  typeFilter,
  onTypeFilter,
  selectedFilters,
  onToggleFilter,
  onClearFilters,
  gridMode,
  onGridMode,
  onOpen,
  onRemove,
  onRemoveTag,
  onSaveGrid,
  onBulkTag,
  onBulkSet,
  onBulkDelete,
  onAddWords,
}: {
  loading: boolean;
  warning: string;
  cards: Flashcard[];
  /** Cards matching search and set/tag filters, before the part-of-speech filter. */
  matchingCards: Flashcard[];
  filteredCards: Flashcard[];
  morphology: NounMorphology;
  knownSets: string[];
  query: string;
  onQuery: (value: string) => void;
  typeFilter: WordsTypeFilter;
  onTypeFilter: (value: WordsTypeFilter) => void;
  selectedFilters: string[];
  onToggleFilter: (key: string) => void;
  onClearFilters: () => void;
  gridMode: boolean;
  onGridMode: (value: boolean) => void;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
  onRemoveTag: (tag: string) => void;
  onSaveGrid: (updated: Flashcard[], original: Flashcard[]) => Promise<boolean>;
  onBulkTag: (ids: number[], tag: string) => Promise<boolean>;
  onBulkSet: (ids: number[], setName: string | null) => Promise<boolean>;
  onBulkDelete: (ids: number[]) => Promise<boolean>;
  onAddWords: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) if (card.setName) counts.set(card.setName, (counts.get(card.setName) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => left.localeCompare(right));
  }, [cards]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => left.localeCompare(right));
  }, [cards]);
  const typeCounts = useMemo(() => Object.fromEntries(cardTypes.map((type) => [type, matchingCards.filter((card) => card.type === type).length])) as Record<CardType, number>, [matchingCards]);
  const visibleIds = new Set(filteredCards.map((card) => card.id));
  const selectedVisible = selectedIds.filter((id) => visibleIds.has(id));
  const allVisibleSelected = filteredCards.length > 0 && selectedVisible.length === filteredCards.length;

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => cards.some((card) => card.id === id)));
  }, [cards]);

  function toggleSelected(id: number) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  async function runBulk(action: () => Promise<boolean>) {
    if (await action()) setSelectedIds([]);
  }

  const rail = <FilterRail sets={sets} tags={tags} selected={selectedFilters} onToggle={onToggleFilter} onClear={onClearFilters} onRemoveTag={onRemoveTag} />;
  const activeFilterCount = selectedFilters.length;

  return <section className="words-view">
    <header className="page-header">
      <div>
        <h1>Words</h1>
        <p>{cards.length} {cards.length === 1 ? "word" : "words"}{filteredCards.length !== cards.length ? ` · ${filteredCards.length} shown` : ""}</p>
      </div>
      <div className="page-header-actions">
        <div className="view-toggle segmented compact" role="radiogroup" aria-label="Layout">
          <button type="button" role="radio" aria-checked={!gridMode} className={!gridMode ? "active" : ""} onClick={() => onGridMode(false)}><Icon name="list" size={16} /> List</button>
          <button type="button" role="radio" aria-checked={gridMode} className={gridMode ? "active" : ""} onClick={() => onGridMode(true)}><Icon name="grid" size={16} /> Grid</button>
        </div>
      </div>
    </header>

    <div className="words-layout">
      <aside className="words-rail" aria-label="Filters">{rail}</aside>
      <div className="words-main">
        <div className="words-toolbar">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search Italian, English, sets, tags…" aria-label="Search words" type="search" />
          </label>
          <button type="button" className={`neutral-button filters-button${activeFilterCount ? " has-filters" : ""}`} onClick={() => setFiltersOpen(true)}><Icon name="filter" size={16} /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
        </div>
        {!gridMode && <div className="segmented type-segmented scrollable" role="radiogroup" aria-label="Part of speech">
          <button type="button" role="radio" aria-checked={typeFilter === "all"} className={typeFilter === "all" ? "active" : ""} onClick={() => onTypeFilter("all")}>All <span className="tab-count">{matchingCards.length}</span></button>
          {cardTypes.map((type) => <button type="button" role="radio" aria-checked={typeFilter === type} key={type} className={`${type} ${typeFilter === type ? "active" : ""}`} onClick={() => onTypeFilter(type)}>{typeLabels[type]}s <span className="tab-count">{typeCounts[type]}</span></button>)}
        </div>}
        {warning && <p className="sync-warning" role="status">{warning}</p>}

        {loading ? <div className="empty-state" role="status"><p>Loading your words…</p></div>
          : !cards.length ? <div className="empty-state"><h2>No words yet</h2><p>Start with a handful of nouns or verbs from your current lesson.</p><button type="button" className="primary-button" onClick={onAddWords}><Icon name="plus" size={16} /> Add words</button></div>
            : !(gridMode ? matchingCards : filteredCards).length ? <div className="empty-state"><h2>No matches</h2><p>Try a different search or clear the filters.</p></div>
              : gridMode ? <InventoryCardsEditor
                key={`${selectedFilters.join("|")}:${query}:${matchingCards.map((item) => item.id).join(",")}`}
                cards={matchingCards}
                knownSets={knownSets}
                morphology={morphology}
                onOpen={onOpen}
                onRemove={onRemove}
                onSave={onSaveGrid}
                onExit={() => onGridMode(false)}
              />
                : <>
                  {selectedVisible.length > 0 && <BulkBar
                    count={selectedVisible.length}
                    knownSets={knownSets}
                    onTag={(tag) => void runBulk(() => onBulkTag(selectedVisible, tag))}
                    onSet={(setName) => void runBulk(() => onBulkSet(selectedVisible, setName))}
                    onDelete={() => { if (window.confirm(`Delete ${selectedVisible.length} ${selectedVisible.length === 1 ? "word" : "words"}? This cannot be undone.`)) void runBulk(() => onBulkDelete(selectedVisible)); }}
                    onClear={() => setSelectedIds([])}
                  />}
                  <div className="word-list" role="table" aria-label="Words">
                    <div className="word-list-head" role="row">
                      <span role="columnheader" className="select-cell"><input type="checkbox" aria-label="Select all shown words" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? [] : filteredCards.map((card) => card.id))} /></span>
                      <span role="columnheader">Italian</span>
                      <span role="columnheader">English</span>
                      <span role="columnheader">Set &amp; tags</span>
                    </div>
                    {filteredCards.map((card) => <div role="row" key={card.id} className={`word-row${selectedIds.includes(card.id) ? " selected" : ""}`}>
                      <span role="cell" className="select-cell"><input type="checkbox" aria-label={`Select ${card.english}`} checked={selectedIds.includes(card.id)} onChange={() => toggleSelected(card.id)} /></span>
                      <button type="button" role="cell" className="word-open" onClick={() => onOpen(card)} aria-label={`Edit ${card.english}`}>
                        <span className="word-italian"><span className={`pos-dot ${card.type}`} title={typeLabels[card.type]} /><strong lang="it">{italianHeadword(card, morphology)}</strong><small lang="it">{secondaryForms(card, morphology)}</small></span>
                        <span className="word-english">{card.english}<small>{typeLabels[card.type].toLowerCase()}</small></span>
                        <span className="word-meta">
                          {card.setName && <span className="chip set">{card.setName}</span>}
                          {card.tags.map((tag) => <span className="chip tag" key={tag}>#{tag}</span>)}
                        </span>
                      </button>
                    </div>)}
                  </div>
                </>}
      </div>
    </div>

    {filtersOpen && <div className="sheet-backdrop sheet-bottom" onMouseDown={() => setFiltersOpen(false)}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Filters" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header"><div className="sheet-title"><h2>Filters</h2></div><button type="button" className="icon-button" onClick={() => setFiltersOpen(false)} aria-label="Close">×</button></header>
        <div className="sheet-body">{rail}<footer className="sheet-actions"><button type="button" className="primary-button" onClick={() => setFiltersOpen(false)}>Show {filteredCards.length} {filteredCards.length === 1 ? "word" : "words"}</button></footer></div>
      </section>
    </div>}
  </section>;
}

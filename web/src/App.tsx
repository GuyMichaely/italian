import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserStorage, type InventoryState } from "./storage";
import type { Flashcard } from "./cards/types";
import { cardDuplicateKey } from "./storage/cardCodec";
import { InventoryConflictError, type MergeChoices } from "./storage/merge";
import { CloudSync, LiveUpdates, readSyncMode, saveSyncMode, type SyncMode, type SyncStatus } from "./storage/cloudSync";
import { storageKey } from "./storage/keys";
import { syncServerUrl } from "./syncServer";
import { ConflictSheet, type ConflictSource } from "./components/ConflictSheet";
import { withEditTimes } from "./cards/edited";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  resolvedNounForms,
  type NounMorphology,
} from "./cards/nounMorphology";
import { cloneAdjectiveMorphology, defaultAdjectiveMorphology, resolvedAdjectiveForms, type AdjectiveMorphology } from "./cards/adjectiveMorphology";
import { cardTypes, typeLabels } from "./cardTypes";
import { useHashRoute } from "./app/useHashRoute";
import { AppShell } from "./components/AppShell";
import type { SaveState } from "./components/SaveIndicator";
import { AddWordsSheet, WordDrawer, localDateStamp } from "./components/CardEditors";
import {
  buildStudyItems,
  shuffled,
  withEnglishPromptFirst,
  type StudyItem,
} from "./study/logic";
import {
  cardScopeKeys,
  cardsInScope,
  readStudySetup,
  writeStudySetup,
  type StudySetup,
} from "./study/setup";
import { cloneStudyPreferences, defaultStudyPreferences, type StudyPreferences } from "./study/preferences";
import type { AnswerCheck } from "./study/nounAnswers";
import { StudyView, type StudyScopeOption } from "./views/StudyView";
import { appendMistakeReviewSet, availableReviewItems, type MistakeReviewSet } from "./study/reviews";
import { WordsView, type WordsTypeFilter } from "./views/WordsView";
import { GrammarView } from "./views/GrammarView";
import { SettingsView } from "./views/SettingsView";


function cardItalianText(card: Flashcard, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  if (card.type === "adjective") return Object.values(resolvedAdjectiveForms(card, adjectiveMorphology).forms).join(" ");
  if (card.type !== "noun") return card.italian;
  const forms = resolvedNounForms(card, morphology);
  return forms.singular || forms.plural;
}

/** A clash waiting for the learner: with another window's save, or with another device's sync. */
type PendingConflict = {
  error: InventoryConflictError;
  source: ConflictSource;
  resolve: (choices: MergeChoices) => Promise<void>;
  /** Closing the screen: drops this window's change, or leaves a sync conflict for later. */
  dismiss: () => void;
};

/** With live updates, a backstop sync every few minutes while the app is open. */
const syncIntervalMs = 5 * 60_000;
const inventoryKey = storageKey("inventory");

function cardSearchText(card: Flashcard, morphology: NounMorphology, adjectiveMorphology: AdjectiveMorphology) {
  let italian = "";
  try {
    italian = cardItalianText(card, morphology, adjectiveMorphology);
  } catch {
    // A word whose rule is broken is still searchable by its other fields.
  }
  const declension = card.type === "noun" || card.type === "adjective" ? card.details.declension : null;
  const base = declension?.kind === "rule" ? declension.base : "";
  return `${card.english} ${italian} ${base} ${card.setName ?? ""} ${card.tags.join(" ")}`.toLowerCase();
}

export default function Home() {
  const [route, navigate] = useHashRoute();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [nounMorphology, setNounMorphology] = useState<NounMorphology>(() => cloneNounMorphology(defaultNounMorphology));
  const [adjectiveMorphology, setAdjectiveMorphology] = useState<AdjectiveMorphology>(() => cloneAdjectiveMorphology(defaultAdjectiveMorphology));
  const [loadingCards, setLoadingCards] = useState(true);
  const storage = useMemo(() => new BrowserStorage(), []);
  // After a sync changed the words here, show them; refreshRef always holds the current function.
  const refreshRef = useRef<() => void>(() => undefined);
  const cloud = useMemo(() => new CloudSync(syncServerUrl, () => refreshRef.current()), []);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloud.current);
  // An unknown stored mode is shown in Settings, and nothing syncs on its own until one is chosen.
  const [syncMode, setSyncMode] = useState<SyncMode | Error>(() => {
    try {
      return readSyncMode();
    } catch (error) {
      return error as Error;
    }
  });
  const syncModeRef = useRef(syncMode);
  syncModeRef.current = syncMode;
  const syncOn = syncStatus.state !== "signed-out" && syncStatus.state !== "expired";
  const savesInFlight = useRef(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [setup, setSetup] = useState<StudySetup>(readStudySetup);
  const [setupOpen, setSetupOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [verificationResult, setVerificationResult] = useState<"correct" | "wrong" | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState("");
  const [submittedCheck, setSubmittedCheck] = useState<AnswerCheck | null>(null);
  const [studyPreferences, setStudyPreferences] = useState<StudyPreferences>(() => cloneStudyPreferences(defaultStudyPreferences));
  const [directionSeed, setDirectionSeed] = useState(0);
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now() >>> 0);
  const [selectedInventoryTags, setSelectedInventoryTags] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<WordsTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [session, setSession] = useState({ right: 0, wrong: 0, skipped: 0 });
  const [sessionComplete, setSessionComplete] = useState(false);
  const [mistakeKeys, setMistakeKeys] = useState<string[]>([]);
  const [reviewSets, setReviewSets] = useState<MistakeReviewSet[]>([]);
  const [activeReviewSetId, setActiveReviewSetId] = useState<number | null>(null);
  const [mistakeTagName, setMistakeTagName] = useState("");
  const [createdMistakeTagName, setCreatedMistakeTagName] = useState("");
  const [windowConflict, setWindowConflict] = useState<PendingConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const { promptMode, typeToVerify, oneDirectionPerWord, englishFirstWhenBoth } = setup;
  const setNames = useMemo(() => Array.from(new Set(cards.map((card) => card.setName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b)), [cards]);
  const tags = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.tags))).sort((a, b) => a.localeCompare(b)), [cards]);
  const suggestedMistakeTagName = useMemo(() => {
    const prefix = `Trouble · ${localDateStamp()} · `;
    return `${prefix}${tags.filter((name) => name.startsWith(prefix)).length + 1}`;
  }, [tags]);
  const effectiveMistakeTagName = mistakeTagName || suggestedMistakeTagName;
  const studyScopeOptions = useMemo<StudyScopeOption[]>(() => [
    ...cardTypes.map((type) => ({ key: `type:${type}`, label: `${typeLabels[type]}s`, kind: "type" as const })),
    ...setNames.map((name) => ({ key: `set:${name}`, label: name, kind: "set" as const })),
    ...tags.map((tag) => ({ key: `tag:${tag}`, label: tag, kind: "tag" as const })),
  ], [setNames, tags]);
  const scopedCards = useMemo(() => cardsInScope(cards, setup), [cards, setup]);
  const allStudyItems = useMemo(() => buildStudyItems(scopedCards, cards, setup, nounMorphology, directionSeed), [cards, directionSeed, nounMorphology, scopedCards, setup]);
  const availableReviewSets = useMemo(() => reviewSets.map((set) => ({ ...set, items: availableReviewItems(set, cards) })), [reviewSets, cards]);
  const activeReviewSet = availableReviewSets.find((set) => set.id === activeReviewSetId);
  const studyItems = useMemo(() => {
    const randomized = shuffled(activeReviewSet ? activeReviewSet.items : allStudyItems, shuffleSeed);
    return englishFirstWhenBoth && promptMode === "both" && !oneDirectionPerWord
      ? withEnglishPromptFirst(randomized)
      : randomized;
  }, [allStudyItems, englishFirstWhenBoth, activeReviewSet, oneDirectionPerWord, promptMode, shuffleSeed]);
  const studyItem = !sessionComplete && studyItems.length && current < studyItems.length ? studyItems[current] : null;
  const typingItalian = Boolean(typeToVerify && (studyItem?.mode === "article" || studyItem?.promptLanguage === "english"));
  const missedItems = useMemo(() => mistakeKeys
    .map((key) => studyItems.find((item) => item.key === key))
    .filter((item): item is StudyItem => Boolean(item)), [mistakeKeys, studyItems]);
  const matchingCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((item) => {
      if (selectedInventoryTags.length && !cardScopeKeys(item).some((key) => selectedInventoryTags.includes(key))) return false;
      return !needle || cardSearchText(item, nounMorphology, adjectiveMorphology).includes(needle);
    });
  }, [adjectiveMorphology, cards, nounMorphology, query, selectedInventoryTags]);
  const filteredCards = useMemo(() => typeFilter === "all" ? matchingCards : matchingCards.filter((item) => item.type === typeFilter), [matchingCards, typeFilter]);

  useEffect(() => {
    let active = true;
    setLoadingCards(true);
    setSyncWarning("");
    storage.readInventory()
      .then((stored) => {
        if (!active) return;
        setCards(stored.cards);
        setNounMorphology(stored.nounMorphology);
        setAdjectiveMorphology(stored.adjectiveMorphology);
        setStudyPreferences(stored.studyPreferences);
      })
      .catch((error) => {
        if (!active) return;
        setSyncWarning(error instanceof Error ? `Storage unavailable: ${error.message}` : "Storage is temporarily unavailable.");
      })
      .finally(() => { if (active) setLoadingCards(false); });
    return () => { active = false; };
  }, [storage]);

  useEffect(() => cloud.subscribe(setSyncStatus), [cloud]);

  // Another window's save, or the extension's, shows here at once, and syncs unless that's manual.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== inventoryKey) return;
      void refreshFromStorage();
      scheduleSync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  });

  // Syncing on its own (see SyncMode): on opening and on coming back (the network, or the tab);
  // automatically also as other devices change things, through a live connection.
  useEffect(() => {
    if (!syncOn || syncMode === "manual" || syncMode instanceof Error) return;
    const sync = () => void cloud.sync();
    const live = syncMode === "automatic" ? new LiveUpdates(syncServerUrl, (version) => { if (version !== cloud.syncedVersion()) sync(); }) : null;
    const whenVisible = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      live?.wake();
    };
    live?.start();
    sync();
    const interval = live ? setInterval(whenVisible, syncIntervalMs) : undefined;
    window.addEventListener("online", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      live?.stop();
      clearInterval(interval);
      window.removeEventListener("online", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [cloud, syncMode, syncOn]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (adding || editingCard || route !== "study" || !studyItem) return;
      if (typingItalian) {
        if (verificationResult && event.key === "Enter") {
          event.preventDefault();
          advanceCard();
        }
        return;
      }
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space" || (!revealed && event.key === "Enter")) {
        event.preventDefault();
        setRevealed((value) => !value);
      } else if (revealed && event.key === "1") {
        event.preventDefault();
        rate("wrong");
      } else if (revealed && (event.key === "2" || event.key === "Enter")) {
        event.preventDefault();
        rate("right");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function rate(result: "right" | "wrong" | "skipped") {
    if (!studyItems.length || !studyItem) return;
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    const nextMistakeKeys = result === "wrong" && !mistakeKeys.includes(studyItem.key) ? [...mistakeKeys, studyItem.key] : mistakeKeys;
    setMistakeKeys(nextMistakeKeys);
    advanceStudy(nextMistakeKeys);
  }

  function verifyItalian(answer: string, check: AnswerCheck) {
    if (!studyItem || verificationResult) return;
    const { correct } = check;
    const result = correct ? "right" : "wrong";
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (!correct) setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    setSubmittedAnswer(answer.trim());
    setSubmittedCheck(check);
    setVerificationResult(correct ? "correct" : "wrong");
    setRevealed(true);
  }

  function advanceCard() {
    advanceStudy(mistakeKeys);
  }

  function advanceStudy(completedMistakeKeys: string[]) {
    if (!studyItem) return;
    if (current + 1 >= studyItems.length) {
      const missed = studyItems.filter((item) => completedMistakeKeys.includes(item.key));
      setReviewSets((sets) => appendMistakeReviewSet(sets, missed, activeReviewSetId));
      setSessionComplete(true);
    }
    else setCurrent((value) => value + 1);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSubmittedCheck(null);
  }

  function applySetup(next: StudySetup) {
    setSetup(next);
    writeStudySetup(next);
    setDirectionSeed((value) => value + 1);
    resetStudyProgress();
  }

  /** Switching between typing and flipping keeps the current session and only resets the open card. */
  function applyAnswerMode(typeToVerify: boolean) {
    const next = { ...setup, typeToVerify };
    setSetup(next);
    writeStudySetup(next);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSubmittedCheck(null);
  }

  function resetStudyProgress() {
    setReviewSets([]);
    setActiveReviewSetId(null);
    resetStudyRound();
  }

  function resetStudyRound() {
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSubmittedCheck(null);
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeTagName("");
    setCreatedMistakeTagName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function toggleInventoryTag(key: string) {
    setSelectedInventoryTags((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  function removeUnavailableInventoryTags(nextCards: Flashcard[]) {
    const availableTagKeys = new Set(nextCards.flatMap((item) => [
      ...(item.setName ? [`set:${item.setName}`] : []),
      ...item.tags.map((tag) => `tag:${tag}`),
    ]));
    setSelectedInventoryTags((items) => items.filter((key) => availableTagKeys.has(key)));
  }

  function restartCurrentStudy() {
    if (activeReviewSetId === null) setDirectionSeed((value) => value + 1);
    resetStudyRound();
  }

  function returnToOriginalStudy() {
    setActiveReviewSetId(null);
    setDirectionSeed((value) => value + 1);
    resetStudyRound();
  }

  function studyMistakes(id: number) {
    if (!availableReviewSets.find((set) => set.id === id)?.items.length) return;
    setActiveReviewSetId(id);
    resetStudyRound();
  }

  function showInventory(state: InventoryState) {
    setCards(state.cards);
    setNounMorphology(state.nounMorphology);
    setAdjectiveMorphology(state.adjectiveMorphology);
    setStudyPreferences(state.studyPreferences);
    removeUnavailableInventoryTags(state.cards);
  }

  /** Shows what's stored here now, unless a save is about to show it. */
  async function refreshFromStorage() {
    if (savesInFlight.current) return;
    try {
      showInventory(await storage.readInventory());
    } catch {
      // The load already reported an unreadable inventory.
    }
  }
  refreshRef.current = () => void refreshFromStorage();

  /** After a change here: syncs shortly, unless this device syncs only when asked. */
  function scheduleSync() {
    if (syncModeRef.current === "manual" || syncModeRef.current instanceof Error || !cloud.signedIn) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void cloud.sync(), 1500);
  }

  /**
   * Shows `next` straight away and saves it, merged with anything changed in another window since
   * this one last read or saved. If the save fails the previous inventory comes back; if it
   * conflicts with the other changes, the conflict screen asks which to keep. Throws the save's error.
   */
  async function saveInventory(changed: InventoryState, failureMessage: string) {
    const previous: InventoryState = { cards, nounMorphology, adjectiveMorphology, studyPreferences };
    const next = { ...changed, cards: withEditTimes(cards, changed.cards) };
    showInventory(next);
    setSyncWarning("");
    setSaveState("saving");
    savesInFlight.current += 1;
    try {
      showInventory(await storage.saveInventory(next));
      setSaveState("saved");
      scheduleSync();
    } catch (error) {
      showInventory(previous);
      setSaveState("failed");
      if (error instanceof InventoryConflictError) showWindowConflict(error, next);
      else setSyncWarning(failureMessage);
      throw error;
    } finally {
      savesInFlight.current -= 1;
    }
  }

  function showWindowConflict(error: InventoryConflictError, next: InventoryState) {
    setWindowConflict({
      error,
      source: "window",
      resolve: async (choices) => {
        try {
          showInventory(await storage.saveInventory(next, choices));
          setWindowConflict(null);
          setConflictOpen(false);
          setSaveState("saved");
          scheduleSync();
        } catch (caught) {
          if (caught instanceof InventoryConflictError) showWindowConflict(caught, next);
          else throw caught;
        }
      },
      dismiss: () => {
        setWindowConflict(null);
        setConflictOpen(false);
        void refreshFromStorage();
      },
    });
    setConflictOpen(true);
  }

  const syncConflict: PendingConflict | null = syncStatus.state === "conflict" ? {
    error: syncStatus.error,
    source: "device",
    resolve: async (choices) => {
      await cloud.sync(choices);
      const after = cloud.current;
      if (after.state === "synced") setConflictOpen(false);
      else if (after.state !== "conflict") throw new Error("message" in after ? after.message : "Sync didn't finish.");
    },
    dismiss: () => setConflictOpen(false),
  } : null;
  const conflict = windowConflict ?? syncConflict;

  /** Saves a complete card list (and optionally new study preferences); false when it couldn't be saved. */
  async function commitCards(nextCards: Flashcard[], failureMessage: string, nextPreferences = studyPreferences) {
    try {
      await saveInventory({ cards: nextCards, nounMorphology, adjectiveMorphology, studyPreferences: nextPreferences }, failureMessage);
      return true;
    } catch {
      return false;
    }
  }

  function persistManyCards(updatedCards: Flashcard[], failureMessage: string) {
    const updatedById = new Map(updatedCards.map((item) => [item.id, item]));
    return commitCards(cards.map((item) => updatedById.get(item.id) ?? item), failureMessage);
  }

  async function createMistakeTag() {
    const name = effectiveMistakeTagName.trim();
    if (!name || !mistakeKeys.length) return;
    setMistakeTagName(name);
    const cardIds = new Set(mistakeKeys.map((key) => Number(key.split(":", 1)[0])).filter(Number.isFinite));
    const updatedCards = cards
      .filter((item) => cardIds.has(item.id))
      .map((item) => ({ ...item, tags: item.tags.includes(name) ? item.tags : [...item.tags, name] }));
    const saved = await persistManyCards(updatedCards, "That mistake tag could not be created. No card tags were changed.");
    if (saved) setCreatedMistakeTagName(name);
  }

  async function removeTagFromExistence(tag: string) {
    const affected = cards.filter((item) => item.tags.includes(tag));
    if (!affected.length || !window.confirm(`Remove #${tag} from ${affected.length} ${affected.length === 1 ? "word" : "words"}?`)) return;
    await persistManyCards(affected.map((item) => ({ ...item, tags: item.tags.filter((itemTag) => itemTag !== tag) })), `#${tag} could not be removed. The tag has been restored.`);
  }

  /** Renames a tag on every word; renaming onto an existing tag merges the two. */
  async function renameTag(from: string, to: string) {
    const affected = cards.filter((item) => item.tags.includes(from));
    if (!affected.length) return;
    setSelectedInventoryTags((keys) => [...new Set(keys.map((key) => key === `tag:${from}` ? `tag:${to}` : key))]);
    const saved = await persistManyCards(
      affected.map((item) => ({ ...item, tags: [...new Set(item.tags.map((tag) => tag === from ? to : tag))] })),
      `#${from} could not be renamed. No words were changed.`,
    );
    if (!saved) return;
    if (setup.selectedScopes.includes(`tag:${from}`)) {
      const next = { ...setup, selectedScopes: [...new Set(setup.selectedScopes.map((key) => key === `tag:${from}` ? `tag:${to}` : key))] };
      setSetup(next);
      writeStudySetup(next);
    }
  }

  function bulkTag(ids: number[], tag: string) {
    const idSet = new Set(ids);
    return persistManyCards(
      cards.filter((item) => idSet.has(item.id)).map((item) => ({ ...item, tags: item.tags.includes(tag) ? item.tags : [...item.tags, tag] })),
      `#${tag} could not be added. No words were changed.`,
    );
  }

  function bulkSet(ids: number[], setName: string | null) {
    const idSet = new Set(ids);
    return persistManyCards(
      cards.filter((item) => idSet.has(item.id)).map((item) => ({ ...item, setName })),
      "Those words could not be moved. No words were changed.",
    );
  }

  async function bulkDelete(ids: number[]) {
    const idSet = new Set(ids);
    const saved = await commitCards(cards.filter((item) => !idSet.has(item.id)), "Those words could not be deleted. They have been restored.");
    if (saved) setCurrent(0);
    return saved;
  }

  async function addBatch(newCards: Flashcard[]) {
    const existingKeys = new Set(cards.map(cardDuplicateKey));
    const newKeys = new Set<string>();
    for (const newCard of newCards) {
      const key = cardDuplicateKey(newCard);
      if (existingKeys.has(key) || newKeys.has(key)) {
        throw new Error(`A ${newCard.type} card for “${cardItalianText(newCard, nounMorphology, adjectiveMorphology)}” / “${newCard.english}” already exists.`);
      }
      newKeys.add(key);
    }
    navigate("words");
    await saveInventory(
      { cards: [...newCards, ...cards], nounMorphology, adjectiveMorphology, studyPreferences },
      "That batch could not be saved and was removed. Please try again.",
    );
  }

  function removeCard(id: number) {
    if (!cards.some((item) => item.id === id)) return;
    setCurrent(0);
    void commitCards(cards.filter((item) => item.id !== id), "That word could not be removed. It has been restored.");
  }

  function updateCard(updated: Flashcard) {
    if (!cards.some((item) => item.id === updated.id)) return;
    void commitCards(cards.map((item) => item.id === updated.id ? updated : item), "That edit could not be saved. The previous version has been restored.");
  }

  async function replaceNounInventory(nextState: InventoryState) {
    await saveInventory(nextState, "Grammar changes could not be saved. The current inventory was left unchanged.");
    setCurrent(0);
    setSessionComplete(false);
  }

  /** Saves study preferences through the inventory, so they sync wherever the inventory does. */
  async function saveStudyPreferences(next: StudyPreferences) {
    await saveInventory({ cards, nounMorphology, adjectiveMorphology, studyPreferences: next }, "Study preferences could not be saved. The previous ones were restored.");
  }

  /** Saves a word from the drawer; a changed "always ask for every form" choice is saved with it. */
  function saveWord(updated: Flashcard, fullDeclension: boolean) {
    const listed = studyPreferences.fullDeclensionCards.includes(updated.id);
    if (updated.type !== "noun" || listed === fullDeclension) {
      updateCard(updated);
      return;
    }
    const fullDeclensionCards = fullDeclension
      ? [...studyPreferences.fullDeclensionCards, updated.id]
      : studyPreferences.fullDeclensionCards.filter((id) => id !== updated.id);
    void commitCards(
      cards.map((item) => item.id === updated.id ? updated : item),
      "That edit could not be saved. The previous version has been restored.",
      { ...studyPreferences, fullDeclensionCards },
    );
  }

  function signInToSync() {
    window.location.href = `${syncServerUrl}/signin`;
  }

  return <>
    <AppShell route={route} sync={syncStatus} syncMode={syncMode} saveState={saveState} onAdd={() => setAdding(true)}>
      {conflict && !conflictOpen && <div className="sync-warning conflict-banner" role="alert">
        <p>{conflict.error.conflicts.length} {conflict.error.conflicts.length === 1 ? "change clashes" : "changes clash"} with {conflict.source === "window" ? "another window" : "another device"}.{conflict.source === "device" ? " Sync is paused until you choose." : ""}</p>
        <button type="button" className="neutral-button" onClick={() => setConflictOpen(true)}>Resolve</button>
      </div>}
      {route === "study" && <StudyView
        loading={loadingCards}
        cards={cards}
        morphology={nounMorphology}
        adjectiveMorphology={adjectiveMorphology}
        preferences={studyPreferences}
        setup={setup}
        setupOpen={setupOpen}
        onSetupOpen={setSetupOpen}
        onApplySetup={applySetup}
        onAnswerMode={applyAnswerMode}
        scopeOptions={studyScopeOptions}
        total={studyItems.length}
        current={current}
        studyItem={studyItem}
        typing={typingItalian}
        revealed={revealed}
        onReveal={setRevealed}
        verificationResult={verificationResult}
        submittedAnswer={submittedAnswer}
        submittedCheck={submittedCheck}
        onVerify={verifyItalian}
        onAdvance={advanceCard}
        onRate={rate}
        session={session}
        sessionComplete={sessionComplete}
        activeReviewSetId={activeReviewSetId}
        reviewSets={availableReviewSets}
        missedItems={missedItems}
        onRestart={restartCurrentStudy}
        onReturnToOriginal={returnToOriginalStudy}
        onStudyMistakes={studyMistakes}
        mistakeTagName={effectiveMistakeTagName}
        onMistakeTagName={setMistakeTagName}
        onCreateMistakeTag={() => void createMistakeTag()}
        createdMistakeTagName={createdMistakeTagName}
        savingTag={saveState === "saving"}
        warning={syncWarning}
        onAddWords={() => setAdding(true)}
      />}
      {route === "words" && <WordsView
        loading={loadingCards}
        warning={syncWarning}
        cards={cards}
        matchingCards={matchingCards}
        filteredCards={filteredCards}
        morphology={nounMorphology}
        adjectiveMorphology={adjectiveMorphology}
        knownSets={setNames}
        query={query}
        onQuery={setQuery}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        selectedFilters={selectedInventoryTags}
        onToggleFilter={toggleInventoryTag}
        onClearFilters={() => setSelectedInventoryTags([])}
        onOpen={setEditingCard}
        onRemove={removeCard}
        onRemoveTag={(tag) => void removeTagFromExistence(tag)}
        onRenameTag={(from, to) => void renameTag(from, to)}
        onSaveGrid={(updatedCards) => persistManyCards(updatedCards, "Those edits could not be saved. The previous words were restored.")}
        onAddGrid={addBatch}
        onBulkTag={bulkTag}
        onBulkSet={bulkSet}
        onBulkDelete={bulkDelete}
        onAddWords={() => setAdding(true)}
      />}
      {route === "grammar" && <>
        {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
        <GrammarView cards={cards} morphology={nounMorphology} adjectiveMorphology={adjectiveMorphology} studyPreferences={studyPreferences} onSave={replaceNounInventory} onOpenCard={setEditingCard} />
      </>}
      {route === "settings" && <>
        {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
        <SettingsView
          storageProps={{ storage, sync: syncStatus, mode: syncMode, onMode: (mode) => { saveSyncMode(mode); setSyncMode(mode); }, onSignIn: signInToSync, onSignOut: () => cloud.signOut(), onSyncNow: () => void cloud.sync(), onResolve: () => setConflictOpen(true) }}
          morphology={nounMorphology}
          adjectiveMorphology={adjectiveMorphology}
          preferences={studyPreferences}
          onPreferences={saveStudyPreferences}
        />
      </>}
    </AppShell>

    {adding && <AddWordsSheet knownSets={setNames} morphology={nounMorphology} adjectiveMorphology={adjectiveMorphology} onClose={() => setAdding(false)} onBatch={addBatch} />}
    {conflict && conflictOpen && <ConflictSheet key={conflict.error.conflicts.map((item) => item.key).join()} error={conflict.error} source={conflict.source} onResolve={conflict.resolve} onClose={conflict.dismiss} />}
    {editingCard && <WordDrawer card={editingCard} knownSets={setNames} morphology={nounMorphology} adjectiveMorphology={adjectiveMorphology} studyPreferences={studyPreferences} onClose={() => setEditingCard(null)} onSave={saveWord} onRemove={removeCard} />}
  </>;
}

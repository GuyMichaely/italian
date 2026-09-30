import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCardStorage,
  readStorageEndpoint,
  readSyncLoadPolicy,
  readSyncPersistLocal,
  saveStorageEndpoint,
  saveSyncLoadPolicy,
  saveSyncPersistLocal,
  type CardStorage,
  type InventoryState,
  type SyncLoadPolicy,
} from "./storage";
import type { Flashcard } from "./cards/types";
import { cardDuplicateKey } from "./storage/cardCodec";
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
  extensionCandidatesToCards,
  extensionImportResultType,
  parseExtensionImportRequest,
  type ExtensionImportResult,
} from "./extensionImport";
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
import { cloneStudyPreferences, defaultStudyPreferences, prunedStudyPreferences, type StudyPreferences } from "./study/preferences";
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
  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [persistLocal, setPersistLocal] = useState(readSyncPersistLocal);
  const [syncLoadPolicy, setSyncLoadPolicy] = useState<SyncLoadPolicy>(readSyncLoadPolicy);
  const storage = useMemo<CardStorage>(() => createCardStorage(storageEndpoint, {
    persistLocal,
    loadPolicy: syncLoadPolicy,
  }), [persistLocal, storageEndpoint, syncLoadPolicy]);
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
  const extensionImportRequests = useRef(new Map<string, Promise<ExtensionImportResult>>());

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

  useEffect(() => {
    function reply(result: ExtensionImportResult) {
      window.postMessage(result, window.location.origin);
    }

    function handleExtensionImport(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      let request;
      try {
        request = parseExtensionImportRequest(event.data);
      } catch (error) {
        const requestId = typeof event.data?.requestId === "string" ? event.data.requestId.trim() : "";
        if (!requestId) return;
        reply({
          source: "parola-web",
          type: extensionImportResultType,
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : "Extension import request is invalid.",
        });
        return;
      }
      if (!request) return;

      let work = extensionImportRequests.current.get(request.requestId);
      if (!work) {
        work = (async (): Promise<ExtensionImportResult> => {
          try {
            const importedCards = extensionCandidatesToCards(request.candidates, nounMorphology, adjectiveMorphology);
            await addBatch(importedCards);
            return {
              source: "parola-web",
              type: extensionImportResultType,
              requestId: request.requestId,
              ok: true,
              importedCount: importedCards.length,
              storage: storageEndpoint ? "sync" : "browser",
            };
          } catch (error) {
            return {
              source: "parola-web",
              type: extensionImportResultType,
              requestId: request.requestId,
              ok: false,
              error: error instanceof Error ? error.message : "Parola could not import the staged candidates.",
            };
          }
        })();
        extensionImportRequests.current.set(request.requestId, work);
      }
      void work.then(reply);
    }

    window.addEventListener("message", handleExtensionImport);
    return () => window.removeEventListener("message", handleExtensionImport);
  });

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

  /** Commits a complete card list through one inventory replacement, restoring the previous state on failure. */
  async function commitCards(nextCards: Flashcard[], failureMessage: string, nextPreferences = studyPreferences) {
    const previousCards = cards;
    const previousPreferences = studyPreferences;
    setCards(nextCards);
    setStudyPreferences(nextPreferences);
    removeUnavailableInventoryTags(nextCards);
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await storage.replaceInventory({ cards: nextCards, nounMorphology, adjectiveMorphology, studyPreferences: nextPreferences });
      setCards(saved.cards);
      setNounMorphology(saved.nounMorphology);
      setAdjectiveMorphology(saved.adjectiveMorphology);
      setStudyPreferences(saved.studyPreferences);
      removeUnavailableInventoryTags(saved.cards);
      setSaveState("saved");
      return true;
    } catch {
      setCards(previousCards);
      setStudyPreferences(previousPreferences);
      removeUnavailableInventoryTags(previousCards);
      setSaveState("failed");
      setSyncWarning(failureMessage);
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

    const temporaryCards = newCards.map((card, index) => ({ ...card, id: -(Date.now() + index) }));
    const temporaryIds = new Set(temporaryCards.map((card) => card.id));
    setCards((items) => [...temporaryCards, ...items]);
    setSyncWarning("");
    setSaveState("saving");
    navigate("words");
    try {
      const savedCards = await storage.createCards(newCards);
      setCards((items) => [...savedCards, ...items.filter((item) => !temporaryIds.has(item.id))]);
      setSaveState("saved");
    } catch (error) {
      setCards((items) => items.filter((item) => !temporaryIds.has(item.id)));
      setSaveState("failed");
      setSyncWarning("That batch could not be saved and was removed. Please try again.");
      throw error;
    }
  }

  function removeCard(id: number) {
    const removed = cards.find((item) => item.id === id);
    if (!removed) return;
    const remainingCards = cards.filter((item) => item.id !== id);
    setCards(remainingCards);
    setStudyPreferences((preferences) => prunedStudyPreferences(preferences, remainingCards, nounMorphology, adjectiveMorphology));
    removeUnavailableInventoryTags(remainingCards);
    setCurrent(0);
    setSaveState("saving");
    void (async () => {
      try {
        await storage.deleteCard(id);
        setSyncWarning("");
        setSaveState("saved");
      } catch {
        setCards((items) => items.some((item) => item.id === id) ? items : [removed, ...items]);
        setSaveState("failed");
        setSyncWarning("That word could not be removed. It has been restored.");
      }
    })();
  }

  function updateCard(updated: Flashcard) {
    const original = cards.find((item) => item.id === updated.id);
    if (!original) return;
    const updatedCards = cards.map((item) => item.id === updated.id ? updated : item);
    setCards(updatedCards);
    removeUnavailableInventoryTags(updatedCards);
    setSyncWarning("");
    setSaveState("saving");
    void (async () => {
      try {
        const savedCard = await storage.updateCard(updated);
        setCards((items) => items.map((item) => item.id === updated.id ? savedCard : item));
        setSaveState("saved");
      } catch {
        setCards((items) => items.map((item) => item.id === updated.id ? original : item));
        setSaveState("failed");
        setSyncWarning("That edit could not be saved. The previous version has been restored.");
      }
    })();
  }

  async function replaceNounInventory(nextState: InventoryState) {
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await storage.replaceInventory(nextState);
      setCards(saved.cards);
      setNounMorphology(saved.nounMorphology);
      setAdjectiveMorphology(saved.adjectiveMorphology);
      setStudyPreferences(saved.studyPreferences);
      removeUnavailableInventoryTags(saved.cards);
      setCurrent(0);
      setSessionComplete(false);
      setSaveState("saved");
    } catch (error) {
      setSaveState("failed");
      setSyncWarning("Grammar changes could not be saved. The current inventory was left unchanged.");
      throw error;
    }
  }

  /** Saves study preferences through the inventory, so they sync wherever the inventory does. */
  async function saveStudyPreferences(next: StudyPreferences) {
    const previous = studyPreferences;
    setStudyPreferences(next);
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await storage.replaceInventory({ cards, nounMorphology, adjectiveMorphology, studyPreferences: next });
      setStudyPreferences(saved.studyPreferences);
      setSaveState("saved");
    } catch (error) {
      setStudyPreferences(previous);
      setSaveState("failed");
      setSyncWarning("Study preferences could not be saved. The previous ones were restored.");
      throw error;
    }
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

  async function applyStorageSettings(endpoint: string, nextPersistLocal: boolean, nextLoadPolicy: SyncLoadPolicy) {
    const normalizedEndpoint = endpoint.trim();
    const effectivePersistLocal = normalizedEndpoint ? nextPersistLocal : true;

    if (!normalizedEndpoint && storageEndpoint) {
      const latestState = storage.syncNow ? await storage.syncNow() : await storage.readInventory();
      await createCardStorage("").replaceInventory(latestState);
      setCards(latestState.cards);
      setNounMorphology(latestState.nounMorphology);
      setAdjectiveMorphology(latestState.adjectiveMorphology);
      setStudyPreferences(latestState.studyPreferences);
    }

    saveStorageEndpoint(normalizedEndpoint);
    saveSyncPersistLocal(effectivePersistLocal);
    saveSyncLoadPolicy(nextLoadPolicy);
    setStorageEndpoint(normalizedEndpoint);
    setPersistLocal(effectivePersistLocal);
    setSyncLoadPolicy(nextLoadPolicy);
    setSyncWarning("");
    setSaveState("idle");
    setCurrent(0);
    setSessionComplete(false);
  }

  async function syncNow() {
    if (!storage.syncNow) return;
    const nextState = await storage.syncNow();
    setCards(nextState.cards);
    setNounMorphology(nextState.nounMorphology);
    setAdjectiveMorphology(nextState.adjectiveMorphology);
    setStudyPreferences(nextState.studyPreferences);
    removeUnavailableInventoryTags(nextState.cards);
    setCurrent(0);
    setSessionComplete(false);
  }

  return <>
    <AppShell route={route} syncing={Boolean(storageEndpoint)} syncLabel={storage.label} saveState={saveState} onAdd={() => setAdding(true)}>
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
          storageProps={{ storage, endpoint: storageEndpoint, persistLocal, loadPolicy: syncLoadPolicy, onApply: applyStorageSettings, onSyncNow: syncNow }}
          morphology={nounMorphology}
          adjectiveMorphology={adjectiveMorphology}
          preferences={studyPreferences}
          onPreferences={saveStudyPreferences}
        />
      </>}
    </AppShell>

    {adding && <AddWordsSheet knownSets={setNames} morphology={nounMorphology} adjectiveMorphology={adjectiveMorphology} onClose={() => setAdding(false)} onBatch={addBatch} />}
    {editingCard && <WordDrawer card={editingCard} knownSets={setNames} morphology={nounMorphology} adjectiveMorphology={adjectiveMorphology} studyPreferences={studyPreferences} onClose={() => setEditingCard(null)} onSave={saveWord} onRemove={removeCard} />}
  </>;
}

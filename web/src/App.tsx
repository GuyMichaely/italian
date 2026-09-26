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
import { hasProductionInventory, readProductionInventory } from "./storage/productionInventory";
import {
  cloneNounMorphology,
  defaultNounMorphology,
  resolvedNounForms,
  type NounMorphology,
} from "./cards/nounMorphology";
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
  shuffled,
  withEnglishPromptFirst,
  type StudyItem,
} from "./study/logic";
import {
  cardScopeKeys,
  cardsInScope,
  readAnswerKeywords,
  readStudySetup,
  writeAnswerKeywords,
  writeStudySetup,
  type AnswerKeywords,
  type PromptLanguage,
  type StudySetup,
} from "./study/setup";
import { StudyView, type StudyScopeOption } from "./views/StudyView";
import { WordsView, type WordsTypeFilter } from "./views/WordsView";
import { GrammarView } from "./views/GrammarView";
import { SettingsView } from "./views/SettingsView";


function cardItalianText(card: Flashcard, morphology: NounMorphology) {
  if (card.type !== "noun") return card.italian;
  const forms = resolvedNounForms(card, morphology);
  return forms.singular || forms.plural;
}

function cardSearchText(card: Flashcard, morphology: NounMorphology) {
  let italian = "";
  try {
    italian = cardItalianText(card, morphology);
  } catch {
    // A noun whose rule is broken is still searchable by its other fields.
  }
  const declension = card.type === "noun" ? card.details.declension : null;
  const base = declension?.kind === "rule" ? declension.base : "";
  return `${card.english} ${italian} ${base} ${card.setName ?? ""} ${card.tags.join(" ")}`.toLowerCase();
}

export default function Home() {
  const [route, navigate] = useHashRoute();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [nounMorphology, setNounMorphology] = useState<NounMorphology>(() => cloneNounMorphology(defaultNounMorphology));
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
  const [answerKeywords, setAnswerKeywords] = useState<AnswerKeywords>(readAnswerKeywords);
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
  const [mistakeOnlyKeys, setMistakeOnlyKeys] = useState<string[] | null>(null);
  const [mistakeTagName, setMistakeTagName] = useState("");
  const [createdMistakeTagName, setCreatedMistakeTagName] = useState("");
  const [productionAvailable] = useState(hasProductionInventory);
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
  const allStudyItems = useMemo(() => scopedCards.flatMap((card): StudyItem[] => {
    if (promptMode === "english" || promptMode === "italian") {
      return [{ key: `${card.id}:${promptMode}`, card, promptLanguage: promptMode }];
    }
    if (oneDirectionPerWord) {
      const promptLanguage: PromptLanguage = Math.abs((card.id * 31) + directionSeed) % 2 === 0 ? "english" : "italian";
      return [{ key: `${card.id}:${promptLanguage}`, card, promptLanguage }];
    }
    return [
      { key: `${card.id}:english`, card, promptLanguage: "english" },
      { key: `${card.id}:italian`, card, promptLanguage: "italian" },
    ];
  }), [directionSeed, oneDirectionPerWord, promptMode, scopedCards]);
  const studyItems = useMemo(() => {
    const randomized = shuffled(mistakeOnlyKeys
      ? mistakeOnlyKeys.map((key) => allStudyItems.find((item) => item.key === key)).filter((item): item is StudyItem => Boolean(item))
      : allStudyItems, shuffleSeed);
    return englishFirstWhenBoth && promptMode === "both" && !oneDirectionPerWord
      ? withEnglishPromptFirst(randomized)
      : randomized;
  }, [allStudyItems, englishFirstWhenBoth, mistakeOnlyKeys, oneDirectionPerWord, promptMode, shuffleSeed]);
  const studyItem = !sessionComplete && studyItems.length && current < studyItems.length ? studyItems[current] : null;
  const typingItalian = Boolean(typeToVerify && studyItem?.promptLanguage === "english");
  const missedItems = useMemo(() => mistakeKeys
    .map((key) => studyItems.find((item) => item.key === key))
    .filter((item): item is StudyItem => Boolean(item)), [mistakeKeys, studyItems]);
  const matchingCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((item) => {
      if (selectedInventoryTags.length && !cardScopeKeys(item).some((key) => selectedInventoryTags.includes(key))) return false;
      return !needle || cardSearchText(item, nounMorphology).includes(needle);
    });
  }, [cards, nounMorphology, query, selectedInventoryTags]);
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
      })
      .catch((error) => {
        if (!active) return;
        setSyncWarning(error instanceof Error ? `Storage unavailable: ${error.message}` : "Storage is temporarily unavailable.");
      })
      .finally(() => { if (active) setLoadingCards(false); });
    return () => { active = false; };
  }, [storage]);

  useEffect(() => {
    writeAnswerKeywords(answerKeywords);
  }, [answerKeywords]);

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
            const importedCards = extensionCandidatesToCards(request.candidates, nounMorphology);
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
    if (result === "wrong") setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    advanceCard();
  }

  function verifyItalian(correct: boolean, answer: string) {
    if (!studyItem || verificationResult) return;
    const result = correct ? "right" : "wrong";
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (!correct) setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    setSubmittedAnswer(answer.trim());
    setVerificationResult(correct ? "correct" : "wrong");
    setRevealed(true);
  }

  function advanceCard() {
    if (current + 1 >= studyItems.length) setSessionComplete(true);
    else setCurrent((value) => value + 1);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
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
  }

  function resetStudyProgress() {
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeOnlyKeys(null);
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
    if (!mistakeOnlyKeys) setDirectionSeed((value) => value + 1);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeTagName("");
    setCreatedMistakeTagName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function returnToOriginalStudy() {
    setMistakeOnlyKeys(null);
    setDirectionSeed((value) => value + 1);
    restartCurrentStudy();
  }

  function studyMistakes() {
    if (!mistakeKeys.length) return;
    setMistakeOnlyKeys([...mistakeKeys]);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeTagName("");
    setCreatedMistakeTagName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  /** Commits a complete card list through one inventory replacement, restoring the previous list on failure. */
  async function commitCards(nextCards: Flashcard[], failureMessage: string) {
    const previousCards = cards;
    setCards(nextCards);
    removeUnavailableInventoryTags(nextCards);
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await storage.replaceInventory({ cards: nextCards, nounMorphology });
      setCards(saved.cards);
      setNounMorphology(saved.nounMorphology);
      removeUnavailableInventoryTags(saved.cards);
      setSaveState("saved");
      return true;
    } catch {
      setCards(previousCards);
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
        throw new Error(`A ${newCard.type} card for “${cardItalianText(newCard, nounMorphology)}” / “${newCard.english}” already exists.`);
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

  async function applyStorageSettings(endpoint: string, nextPersistLocal: boolean, nextLoadPolicy: SyncLoadPolicy) {
    const normalizedEndpoint = endpoint.trim();
    const effectivePersistLocal = normalizedEndpoint ? nextPersistLocal : true;

    if (!normalizedEndpoint && storageEndpoint) {
      const latestState = storage.syncNow ? await storage.syncNow() : await storage.readInventory();
      await createCardStorage("").replaceInventory(latestState);
      setCards(latestState.cards);
      setNounMorphology(latestState.nounMorphology);
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

  /** Prototype-only: copy the current Parola app's words into this build's separate storage. */
  async function copyProductionInventory() {
    if (cards.length && !window.confirm("Replace this prototype's words and grammar with a copy from the current Parola app? The current app is not changed.")) return;
    setSyncWarning("");
    try {
      const state = readProductionInventory();
      setSaveState("saving");
      const saved = await storage.replaceInventory(state);
      setCards(saved.cards);
      setNounMorphology(saved.nounMorphology);
      removeUnavailableInventoryTags(saved.cards);
      resetStudyProgress();
      setSaveState("saved");
    } catch (error) {
      setSaveState("failed");
      setSyncWarning(error instanceof Error ? `Could not copy from the current app: ${error.message}` : "Could not copy from the current app.");
    }
  }

  async function syncNow() {
    if (!storage.syncNow) return;
    const nextState = await storage.syncNow();
    setCards(nextState.cards);
    setNounMorphology(nextState.nounMorphology);
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
        keywords={answerKeywords}
        setup={setup}
        setupOpen={setupOpen}
        onSetupOpen={setSetupOpen}
        onApplySetup={applySetup}
        onAnswerMode={applyAnswerMode}
        scopeOptions={studyScopeOptions}
        items={studyItems}
        current={current}
        studyItem={studyItem}
        typing={typingItalian}
        revealed={revealed}
        onReveal={setRevealed}
        verificationResult={verificationResult}
        submittedAnswer={submittedAnswer}
        onVerify={verifyItalian}
        onAdvance={advanceCard}
        onRate={rate}
        session={session}
        sessionComplete={sessionComplete}
        reviewingMistakes={Boolean(mistakeOnlyKeys)}
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
        onCopyProduction={productionAvailable ? () => void copyProductionInventory() : undefined}
      />}
      {route === "words" && <WordsView
        loading={loadingCards}
        warning={syncWarning}
        cards={cards}
        matchingCards={matchingCards}
        filteredCards={filteredCards}
        morphology={nounMorphology}
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
        onCopyProduction={productionAvailable ? () => void copyProductionInventory() : undefined}
      />}
      {route === "grammar" && <>
        {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
        <GrammarView cards={cards} morphology={nounMorphology} onSave={replaceNounInventory} onOpenCard={setEditingCard} />
      </>}
      {route === "settings" && <>
        {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
        <SettingsView
          storageProps={{ storage, endpoint: storageEndpoint, persistLocal, loadPolicy: syncLoadPolicy, onApply: applyStorageSettings, onSyncNow: syncNow }}
          keywords={answerKeywords}
          onKeywords={setAnswerKeywords}
          onCopyProduction={productionAvailable ? () => void copyProductionInventory() : undefined}
        />
      </>}
    </AppShell>

    {adding && <AddWordsSheet knownSets={setNames} morphology={nounMorphology} onClose={() => setAdding(false)} onBatch={addBatch} />}
    {editingCard && <WordDrawer card={editingCard} knownSets={setNames} morphology={nounMorphology} onClose={() => setEditingCard(null)} onSave={updateCard} onRemove={removeCard} />}
  </>;
}

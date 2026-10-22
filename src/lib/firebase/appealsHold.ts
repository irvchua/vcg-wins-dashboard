import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import type { AppealHoldEntry, AppealImage, AppealLink } from "../../types";
import { cleanFirestoreData, FirestoreConflictError as RecordConflictError, getFirebaseApp, isFirebaseAppConfigured } from "./auth";

export { RecordConflictError };

// Source files can be large (phone photos); they are re-encoded as JPEG before saving so
// each image document stays under Firestore's 1 MiB document limit.
export const maxAppealImageSourceBytes = 25 * 1024 * 1024;
const maxStoredImageChars = 900_000;
const compressionSteps: Array<[maxSide: number, quality: number]> = [
  [2000, 0.85], [1600, 0.8], [1280, 0.75], [1024, 0.7], [800, 0.65],
];

export const firebaseAppealsHoldBoardId = import.meta.env.VITE_FIREBASE_APPEALS_HOLD_BOARD_ID;
export const isAppealsHoldFirebaseConfigured = isFirebaseAppConfigured && Boolean(firebaseAppealsHoldBoardId);

function getBoardDocRef() {
  if (!isAppealsHoldFirebaseConfigured) return null;
  const app = getFirebaseApp();
  if (!app) return null;

  return doc(getFirestore(app), "appealsHoldBoards", firebaseAppealsHoldBoardId);
}

function getRecordsCollectionRef() {
  const boardDocRef = getBoardDocRef();
  return boardDocRef ? collection(boardDocRef, "records") : null;
}

function getRecordDocRef(id: number) {
  const recordsRef = getRecordsCollectionRef();
  return recordsRef ? doc(recordsRef, String(id)) : null;
}

function createAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Older rows (and the spreadsheet import) kept a letter's link and date in one free-text
// field. Split it: the first URL is the letter link, any further URLs become extra links,
// and whatever remains is the date.
export function splitLetterField(value: string, letterName: string): { date: string; url: string; extraLinks: AppealLink[] } {
  const urls = value.match(/https?:\/\/\S+/gi) ?? [];
  const date = urls.reduce((rest, url) => rest.replace(url, " "), value).replace(/\s+/g, " ").trim();
  const extraLinks = urls.slice(1).map((url, index) => ({
    id: createAttachmentId(),
    label: `${letterName} ${index + 2}`,
    url,
  }));
  return { date, url: urls[0] ?? "", extraLinks };
}

// Rows saved before the letter link fields existed are migrated on read; the legacy
// field is dropped the next time the row is saved.
export function normalizeAppealRecord(raw: AppealHoldEntry): AppealHoldEntry {
  const { decisionLetterLinkOrDate, ...entry } = raw;
  const instruction = entry.instructionLetterUrl === undefined
    ? splitLetterField(entry.instructionDate ?? "", "Instruction Letter")
    : null;
  const decision = entry.decisionLetterUrl === undefined
    ? splitLetterField(entry.decisionLetterDate ?? decisionLetterLinkOrDate ?? "", "Decision Letter")
    : null;
  return {
    ...entry,
    instructionDate: instruction ? instruction.date : entry.instructionDate ?? "",
    instructionLetterUrl: instruction ? instruction.url : entry.instructionLetterUrl ?? "",
    decisionLetterDate: decision ? decision.date : entry.decisionLetterDate ?? "",
    decisionLetterUrl: decision ? decision.url : entry.decisionLetterUrl ?? "",
    links: [
      ...(instruction?.extraLinks ?? []),
      ...(decision?.extraLinks ?? []),
      ...(Array.isArray(entry.links) ? entry.links : []),
    ],
    images: Array.isArray(entry.images) ? entry.images : [],
  };
}

export function subscribeToAppealRecords(
  onData: (entries: AppealHoldEntry[]) => void,
  onError: (error: Error) => void
) {
  const recordsRef = getRecordsCollectionRef();
  if (!recordsRef) return null;

  return onSnapshot(recordsRef, (snapshot) => {
    const entries = snapshot.docs
      .map((recordDoc) => normalizeAppealRecord(recordDoc.data() as AppealHoldEntry))
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    onData(entries);
  }, onError);
}

export async function createAppealRecord(entry: AppealHoldEntry, actor: string) {
  const saved: AppealHoldEntry = { ...entry, updatedAt: new Date().toISOString(), updatedBy: actor, version: 1 };
  const recordRef = getRecordDocRef(entry.id);
  if (!recordRef) return saved;

  await setDoc(recordRef, cleanFirestoreData(saved));
  return saved;
}

export async function saveAppealRecord(entry: AppealHoldEntry, expectedVersion: number, actor: string) {
  const recordRef = getRecordDocRef(entry.id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return { ...entry, updatedBy: actor, version: expectedVersion + 1 };

  const database = getFirestore(app);
  const updatedAt = new Date().toISOString();
  const saved: AppealHoldEntry = { ...entry, updatedAt, updatedBy: actor, version: expectedVersion + 1 };
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists() || (snapshot.data().version ?? 1) !== expectedVersion) {
      throw new RecordConflictError();
    }
    transaction.set(recordRef, cleanFirestoreData(saved));
  });
  return saved;
}

export async function deleteAppealRecord(id: number, expectedVersion: number) {
  const recordRef = getRecordDocRef(id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return;

  await runTransaction(getFirestore(app), async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists()) return;
    if ((snapshot.data().version ?? 1) !== expectedVersion) throw new RecordConflictError();
    transaction.delete(recordRef);
  });
}

function getImageDocRef(recordId: number, imageId: string) {
  const recordRef = getRecordDocRef(recordId);
  return recordRef ? doc(collection(recordRef, "images"), imageId) : null;
}

export class AppealImageReadError extends Error {
  constructor(fileName: string) {
    super(`${fileName} could not be read. Try a JPG or PNG.`);
    this.name = "AppealImageReadError";
  }
}

async function compressImage(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AppealImageReadError(file.name);
  }
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new AppealImageReadError(file.name);
    for (const [maxSide, quality] of compressionSteps) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // JPEG has no transparency; flatten screenshots onto white instead of black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= maxStoredImageChars) return dataUrl;
    }
    throw new Error(`${file.name} is too detailed to store, even after shrinking it.`);
  } finally {
    bitmap.close();
  }
}

// Object URLs for images already loaded this session, so reopening a row doesn't re-read
// the image documents (and they open in a new tab, which data: URLs can't).
const imageUrlCache = new Map<string, Promise<string>>();

async function dataUrlToObjectUrl(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return URL.createObjectURL(blob);
}

export function loadAppealImageUrl(image: AppealImage): Promise<string> {
  const cached = imageUrlCache.get(image.id);
  if (cached) return cached;
  const imageRef = getImageDocRef(image.recordId, image.id);
  if (!imageRef) return Promise.reject(new Error("Image storage is not configured."));

  const loading = getDoc(imageRef).then((snapshot) => {
    const dataUrl = snapshot.data()?.dataUrl;
    if (typeof dataUrl !== "string") throw new Error(`${image.name} is missing.`);
    return dataUrlToObjectUrl(dataUrl);
  });
  imageUrlCache.set(image.id, loading);
  loading.catch(() => imageUrlCache.delete(image.id));
  return loading;
}

export async function uploadAppealImage(recordId: number, file: File, actor: string): Promise<AppealImage> {
  const dataUrl = await compressImage(file);
  const image: AppealImage = {
    id: createAttachmentId(),
    recordId,
    name: file.name || "image",
    contentType: "image/jpeg",
    size: Math.round(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4),
    uploadedAt: new Date().toISOString(),
    uploadedBy: actor,
  };
  const imageRef = getImageDocRef(recordId, image.id);
  if (imageRef) {
    await setDoc(imageRef, { ...image, dataUrl });
  }
  imageUrlCache.set(image.id, dataUrlToObjectUrl(dataUrl));
  return image;
}

// Best-effort cleanup: an image that is already gone is not an error, and a failed delete
// only leaves an orphaned document behind, so callers never need to block on this.
export async function deleteAppealImages(images: AppealImage[]) {
  await Promise.all(images.map(async (image) => {
    imageUrlCache.get(image.id)?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    imageUrlCache.delete(image.id);
    const imageRef = getImageDocRef(image.recordId, image.id);
    if (!imageRef) return;
    try {
      await deleteDoc(imageRef);
    } catch (error) {
      console.error("Appeal image cleanup failed:", error);
    }
  }));
}

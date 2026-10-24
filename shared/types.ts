/** Shared wire types from docs/API_CONTRACT.md. They do not implement endpoints. */
export type Language = 'en' | 'fil';
export type TranscriptionLanguage = Language | 'auto';
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ChatImage {
  mimeType: ImageMimeType;
  base64: string;
}

export interface ChatRequest {
  conversationId: string | null;
  clientMessageId: string;
  language: Language;
  /** 1–4000 characters; runtime validation belongs on the server. */
  message: string;
  /** Maximum decoded size: 4 MiB. */
  image: ChatImage | null;
}

export interface EvidenceReference {
  evidenceId: string;
  documentId: string;
  /** One-based physical PDF page, independent of printedLabel. */
  pdfPage: number;
  printedLabel: string | null;
  section: string | null;
}

interface MessageBase {
  id: string;
  text: string;
}

export interface GroundedMessage extends MessageBase {
  kind: 'grounded';
  references: [EvidenceReference, ...EvidenceReference[]];
}

export interface ClarificationMessage extends MessageBase {
  kind: 'clarification';
  references: EvidenceReference[];
}

export interface ConsentPromptMessage extends MessageBase {
  kind: 'consent_prompt';
  references: [];
}

export interface GeneralMessage extends MessageBase {
  kind: 'general';
  references: [];
}

export interface AcknowledgementMessage extends MessageBase {
  kind: 'acknowledgement';
  references: [];
}

export type AssistantMessage = GroundedMessage | ClarificationMessage
  | ConsentPromptMessage | GeneralMessage | AcknowledgementMessage;

export interface PendingGeneral {
  id: string;
  question: string;
}

/** General answers can only be returned by /api/consent after Continue. */
export type ChatResponse = { conversationId: string } & (
  | { assistantMessage: GroundedMessage; pendingGeneral: PendingGeneral | null }
  | { assistantMessage: ClarificationMessage | AcknowledgementMessage; pendingGeneral: null }
  | { assistantMessage: ConsentPromptMessage; pendingGeneral: PendingGeneral }
);

export interface ConsentRequest {
  conversationId: string;
  pendingId: string;
  clientActionId: string;
  decision: 'continue' | 'cancel';
  language: Language;
}

export interface ConsentResponse {
  conversationId: string;
  assistantMessage: GeneralMessage | AcknowledgementMessage;
  pendingGeneral: null;
}

/** Serialize as multipart/form-data, never JSON. Audio limits: 10 MiB / 60 seconds. */
export interface TranscribeRequest {
  audio: File;
  language: TranscriptionLanguage;
}

export interface TranscribeResponse {
  text: string;
}

export interface DocumentMetadata {
  documentId: string;
  title: string;
  edition: string | null;
  /** Positive at runtime; 0 in the contract is only an illustration. */
  pageCount: number;
  sha256: string;
  pdfUrl: string;
}

export type ApiErrorCode =
  | 'INVALID_REQUEST' | 'INVALID_CONSENT' | 'EMPTY_TRANSCRIPT' | 'UNSUPPORTED_AUDIO'
  | 'SESSION_EXPIRED' | 'DOCUMENT_NOT_FOUND'
  | 'REQUEST_IN_PROGRESS' | 'CONSENT_PENDING' | 'STALE_CONSENT'
  | 'IMAGE_TOO_LARGE' | 'AUDIO_TOO_LARGE'
  | 'INVALID_MODEL_RESPONSE' | 'UNREADABLE_IMAGE'
  | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE' | 'SOURCE_NOT_READY' | 'REQUEST_TIMEOUT';

export interface ApiErrorResponse {
  error: { code: ApiErrorCode; message: string; retryable: boolean };
}

/** Preflight-only service liveness; says nothing about providers or the PDF. */
export interface HealthResponse {
  status: 'ok';
}

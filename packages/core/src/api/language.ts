/**
 * Contract types of the intent language endpoints, shared by the API, the
 * web Oracle (⌘K), Telegram and the Elysium Agent.
 *
 *   POST /v1/intents/parse     sentence (English or Turkish) -> typed goals,
 *                              clarifying questions, live chips, canonical sentence
 *   GET  /v1/language/examples curated example sentences per category and locale
 *
 * The reader is deterministic and fail closed: an unknown word leaves its
 * clause unread (never half-read, never guessed), and a missing or ambiguous
 * slot becomes a question with options instead of a refusal. The API is
 * stateless: the client sends the same text back with its answers (and the
 * signed `thread` token of the previous turn, which carries earlier answers
 * but never the user's words).
 */
import type { LanguageGoal } from "../goals.js";

export const LANGUAGE_API_VERSION = "elyia.api.language/v1" as const;
export const LANGUAGE_SPEC = "elyia.language/v1" as const;

export const LANGUAGE_LOCALES = Object.freeze(["en", "tr"] as const);
export type LanguageLocale = (typeof LANGUAGE_LOCALES)[number];

/** Limits the API enforces on a parse request. */
export const LANGUAGE_LIMITS = Object.freeze({
  /** Characters of input text. */
  maxTextLength: 500,
  /** Answers per request (one per open question; earlier answers ride in `thread`). */
  maxAnswers: 12,
  /** Characters of a free-text answer. */
  maxAnswerTextLength: 80,
  /** Questions returned per turn (the rest are asked once these are answered). */
  maxQuestions: 2,
  /** Options per question. */
  maxOptions: 8,
  /** Thread token lifetime. */
  threadTtlSeconds: 1_800,
});

/** What a chip highlights in the typed text (the Oracle colours chips by kind). */
export const CHIP_KINDS = Object.freeze([
  "verb", "side", "amount", "asset", "market", "leverage", "margin", "price", "trigger", "duration", "schedule",
  "condition", "network", "account", "recipient", "order", "alert", "query", "connector", "unknown",
  // A named protocol ("kalos", "Kinetiq'te"): appended in v1.1.
  "venue",
] as const);
export type ChipKind = (typeof CHIP_KINDS)[number];

export interface LanguageChip {
  /** The typed text the chip covers (exactly `text.slice(span[0], span[1])`). */
  readonly text: string;
  readonly kind: ChipKind;
  /** UTF-16 offsets into the request text. */
  readonly span: readonly [number, number];
  /** How Elyia read it ("10", "ETH perp", "5x", "Elysium", "below"), in Elyia's words. */
  readonly value?: string;
}

/**
 * Why a question is asked. Purpose questions (the user's goal) are
 * never answered on their behalf by an agent; means questions (how to do it)
 * may carry a recommended option.
 */
export const LANGUAGE_REASONS = Object.freeze([
  // formats
  "AMOUNT_FORMAT_AMBIGUOUS",
  "LEVERAGE_FORMAT",
  // assets and markets
  "ASSET_TYPO",
  "ASSET_LOOKALIKE",
  "MARKET_UNKNOWN",
  "MARKET_AMBIGUOUS",
  "MARKET_KIND",
  "SELL_INTENT",
  // missing purpose slots
  "SIDE_MISSING",
  "INPUT_ASSET_MISSING",
  "OUTPUT_ASSET_MISSING",
  "DESTINATION_MISSING",
  "SOURCE_MISSING",
  "RECIPIENT_MISSING",
  "RECIPIENT_UNRESOLVED",
  "TRANSFER_NETWORK",
  "AMOUNT_MISSING",
  "SIZE_BASIS_AMBIGUOUS",
  "LEVERAGE_MISSING",
  "LEVERAGE_ABOVE_MAX",
  "STOP_BASIS",
  "PRICE_MISSING",
  "TRIGGER_MISSING",
  "POSITION_AMBIGUOUS",
  // balances and routes
  "AMOUNT_EXCEEDS_BALANCE",
  "NETWORK_AMBIGUOUS",
  "STAKE_ORDER",
  "UNSTAKE_ROUTE",
  "SCALE_ORDERS",
  "DURATION_RANGE",
  // automations
  "TRIGGER_AMBIGUOUS",
  "FUNDING_PERIOD_AMBIGUOUS",
  "RULE_END_MISSING",
  "RULE_CAP_MISSING",
  "TIMEZONE_MISSING",
] as const);
export type LanguageReason = (typeof LANGUAGE_REASONS)[number];

/** Reasons an assistant (MCP client, Telegram bot, the Elysium Agent) must relay to the user, never answer. */
export const PURPOSE_REASONS: readonly LanguageReason[] = Object.freeze([
  "AMOUNT_FORMAT_AMBIGUOUS", "LEVERAGE_FORMAT", "ASSET_TYPO", "ASSET_LOOKALIKE", "MARKET_AMBIGUOUS", "MARKET_KIND", "SELL_INTENT",
  "SIDE_MISSING", "INPUT_ASSET_MISSING", "OUTPUT_ASSET_MISSING", "DESTINATION_MISSING", "SOURCE_MISSING", "RECIPIENT_MISSING",
  "RECIPIENT_UNRESOLVED", "TRANSFER_NETWORK", "AMOUNT_MISSING", "SIZE_BASIS_AMBIGUOUS", "LEVERAGE_MISSING", "LEVERAGE_ABOVE_MAX",
  "STOP_BASIS", "PRICE_MISSING", "TRIGGER_MISSING", "POSITION_AMBIGUOUS", "AMOUNT_EXCEEDS_BALANCE", "TRIGGER_AMBIGUOUS",
  "FUNDING_PERIOD_AMBIGUOUS", "RULE_END_MISSING", "RULE_CAP_MISSING", "UNSTAKE_ROUTE", "STAKE_ORDER", "TIMEZONE_MISSING",
]);

export interface LanguageOption {
  /** Stable id within the question; send it back as `answers[].option`. */
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  /** Only means questions recommend; purpose questions never do. */
  readonly recommended?: boolean;
}

export interface LanguageQuestion {
  /** Deterministic for the same text and facts ("g0.leverage"); answer with `answers[].question`. */
  readonly id: string;
  /** Index into `goals` of the goal this question completes (-1: the whole sentence). */
  readonly goal: number;
  /** The slot it fills ("leverage", "size", "market", "network", ...). */
  readonly field: string;
  readonly reason: LanguageReason;
  /** In the request locale. */
  readonly prompt: string;
  readonly options: readonly LanguageOption[];
  /** A typed answer is accepted (an amount, a price, an address). */
  readonly allowsText: boolean;
  readonly placeholder?: string;
  /** True when only the user may answer (see PURPOSE_REASONS). */
  readonly purpose: boolean;
}

/** A means slot Elyia filled on its own; shown as a chip the user can change. */
export interface LanguageAssumption {
  readonly goal: number;
  readonly field: string;
  readonly label: string;
  /** Changes what happens (a default network, a derived cap, a corrected typo): show it prominently. */
  readonly material: boolean;
}

export interface LanguageWarning {
  readonly code: string;
  readonly message: string;
  readonly span?: readonly [number, number];
}

export interface LanguageAnswer {
  /** `LanguageQuestion.id`. */
  readonly question: string;
  /** `LanguageOption.id` (or `text`). */
  readonly option?: string;
  readonly text?: string;
}

/**
 * ready: every goal is complete (it may still carry assumptions and warnings).
 * needs_input: answer `questions` (goals are the partial reading).
 * unreadable: some clause could not be read; nothing was guessed.
 * control: the whole text is a thread control ("cancel", "iptal").
 */
export type LanguageStatus = "ready" | "needs_input" | "unreadable" | "control";

/** Facts a client may share to sharpen questions (never trusted for execution; the planner re-reads everything). */
export interface LanguageContext {
  readonly balances?: readonly { readonly network: string; readonly symbol: string; readonly amount: string }[];
  readonly positions?: readonly { readonly coin: string; readonly side: "long" | "short"; readonly size: string; readonly leverage?: number }[];
  /** IANA time zone for scheduled automations ("Europe/Istanbul"). */
  readonly timezone?: string;
  readonly telegramLinked?: boolean;
}

/** POST /v1/intents/parse */
export interface ParseIntentBody {
  readonly text: string;
  /** Default: detected from the text (Turkish words, letters and suffixes), else English. */
  readonly locale?: LanguageLocale;
  readonly answers?: readonly LanguageAnswer[];
  /** The `thread` of the previous response for the same text. */
  readonly thread?: string;
  /** 0x owner address: HyperCore positions and spot balances are read for balance-aware questions. */
  readonly account?: string;
  readonly context?: LanguageContext;
}

export interface ParseIntentResponse {
  readonly spec: typeof LANGUAGE_SPEC;
  readonly status: LanguageStatus;
  readonly locale: LanguageLocale;
  /** The reading, one entry per clause goal (complete when status is ready). */
  readonly goals: readonly LanguageGoal[];
  /** At most LANGUAGE_LIMITS.maxQuestions, the most important first. */
  readonly questions: readonly LanguageQuestion[];
  /** Questions still waiting after these (asked next turn). */
  readonly pendingQuestions: number;
  readonly assumptions: readonly LanguageAssumption[];
  readonly chips: readonly LanguageChip[];
  /** The reading as one English sentence in Elyia's grammar (re-reads to the same goals); null unless ready. */
  readonly canonical: string | null;
  readonly warnings: readonly LanguageWarning[];
  /** Signed token holding the answers so far; send it back with the next turn. Null when nothing was answered or asked. */
  readonly thread: string | null;
  readonly control?: "cancel";
  /** Example sentences, when nothing could be read. */
  readonly examples?: readonly string[];
  /** Where USD figures in prompts and caps came from. */
  readonly priceSource?: "reference:hypercore-mainnet-mids";
}

export const EXAMPLE_CATEGORIES = Object.freeze(["trade", "protect", "value", "automate", "alert", "query"] as const);
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

export interface LanguageExample {
  readonly text: string;
  /** The canonical sentence it reads to (English). */
  readonly canonical: string | null;
  /** Whether it reads ready or asks a question first. */
  readonly status: LanguageStatus;
}

/** GET /v1/language/examples?locale= */
export interface LanguageExamplesResponse {
  readonly spec: typeof LANGUAGE_SPEC;
  readonly locale: LanguageLocale;
  readonly categories: readonly {
    readonly id: ExampleCategory;
    readonly title: string;
    readonly examples: readonly LanguageExample[];
  }[];
}

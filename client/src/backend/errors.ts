import { Schema } from "effect";

const ErrorFields = { message: Schema.String } as const;

export class IdentityUnavailable extends Schema.TaggedError<IdentityUnavailable>()(
  "IdentityUnavailable",
  ErrorFields,
) {}
export class IdentityRejected extends Schema.TaggedError<IdentityRejected>()(
  "IdentityRejected",
  ErrorFields,
) {}
export type IdentityError = IdentityUnavailable | IdentityRejected;

export class SessionUnavailable extends Schema.TaggedError<SessionUnavailable>()(
  "SessionUnavailable",
  ErrorFields,
) {}
export class SessionRejected extends Schema.TaggedError<SessionRejected>()(
  "SessionRejected",
  ErrorFields,
) {}
export type SessionError = SessionUnavailable | SessionRejected;

export class RunsUnavailable extends Schema.TaggedError<RunsUnavailable>()(
  "RunsUnavailable",
  ErrorFields,
) {}
export class RunsRejected extends Schema.TaggedError<RunsRejected>()(
  "RunsRejected",
  ErrorFields,
) {}
export class RunsSessionExpired extends Schema.TaggedError<RunsSessionExpired>()(
  "RunsSessionExpired",
  ErrorFields,
) {}
export class RunsOffline extends Schema.TaggedError<RunsOffline>()(
  "RunsOffline",
  ErrorFields,
) {}
export type RunsError =
  | RunsUnavailable
  | RunsRejected
  | RunsSessionExpired
  | RunsOffline;

export class ContentUnavailable extends Schema.TaggedError<ContentUnavailable>()(
  "ContentUnavailable",
  ErrorFields,
) {}
export type ContentError = ContentUnavailable;

export class BoardsUnavailable extends Schema.TaggedError<BoardsUnavailable>()(
  "BoardsUnavailable",
  ErrorFields,
) {}
export type BoardsError = BoardsUnavailable;

export class EconomyUnavailable extends Schema.TaggedError<EconomyUnavailable>()(
  "EconomyUnavailable",
  ErrorFields,
) {}
export class EconomyRejected extends Schema.TaggedError<EconomyRejected>()(
  "EconomyRejected",
  ErrorFields,
) {}
export type EconomyError = EconomyUnavailable | EconomyRejected;

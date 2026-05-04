/**
 * Drizzle schema for Pulse.
 *
 * Conventions:
 *   - `users.id` is the Clerk user ID (text), not a UUID.
 *   - Every other table has `user_id text` referencing `users.id` so RLS
 *     policies can match `auth.uid()::text = user_id`.
 *   - Money is stored as `numeric(14, 2)` and surfaced in TS as `string`
 *     (postgres-js default) — convert with Number() or a decimal lib at
 *     the edge to avoid float drift.
 *   - Cascade rules: deleting a user wipes all their data; deleting an
 *     account or category nulls out the FK on transactions/shortcuts so
 *     historical rows aren't lost.
 */
import { relations } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────
export const accountTypeEnum = pgEnum("account_type", [
  "cash",
  "bank",
  "credit",
  "wallet",
  "savings",
]);

export const categoryTypeEnum = pgEnum("category_type", ["income", "expense"]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
]);

export const frequencyEnum = pgEnum("frequency", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const budgetPeriodEnum = pgEnum("budget_period", ["weekly", "monthly"]);

export const insightTypeEnum = pgEnum("insight_type", [
  "weekly_summary",
  "anomaly",
  "tip",
  "streak",
]);

// ──────────────────────────────────────────────────────────────────────────
// Tables
// ──────────────────────────────────────────────────────────────────────────

/** App-level user profile. PK is the Clerk user ID. */
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user_id (e.g. user_2abc...)
  email: text("email").notNull(),
  name: text("name"),
  currency: text("currency").notNull().default("PKR"),
  theme: text("theme").notNull().default("dark"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Money buckets the user owns: cash, a bank account, a credit card, etc. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    balance: numeric("balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    color: text("color").notNull().default("#10b981"),
    icon: text("icon").notNull().default("wallet"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("accounts_user_id_idx").on(t.userId),
  }),
);

/** Categorisation tree (self-referential via parent_id for sub-categories). */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    color: text("color").notNull(),
    type: categoryTypeEnum("type").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    userIdx: index("categories_user_id_idx").on(t.userId),
  }),
);

/** Recurring rule (declared before transactions to avoid forward FK). */
export const recurring = pgTable(
  "recurring",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    frequency: frequencyEnum("frequency").notNull(),
    nextRun: date("next_run").notNull(),
    note: text("note"),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    userIdx: index("recurring_user_id_idx").on(t.userId),
    nextRunIdx: index("recurring_next_run_idx").on(t.nextRun),
  }),
);

/** A single ledger entry (income, expense, or transfer leg). */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    type: transactionTypeEnum("type").notNull(),
    note: text("note"),
    date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringId: uuid("recurring_id").references(() => recurring.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("transactions_user_id_idx").on(t.userId),
    accountIdx: index("transactions_account_idx").on(t.accountId),
    categoryIdx: index("transactions_category_idx").on(t.categoryId),
    userDateIdx: index("transactions_user_date_idx").on(t.userId, t.date),
  }),
);

/** Spending caps per category for a given period. */
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    period: budgetPeriodEnum("period").notNull(),
    startDate: date("start_date").notNull(),
  },
  (t) => ({
    userIdx: index("budgets_user_id_idx").on(t.userId),
  }),
);

/** Quick-add tile (e.g. "Coffee, 250 PKR, Food, Cash"). */
export const shortcuts = pgTable(
  "shortcuts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
  },
  (t) => ({
    userIdx: index("shortcuts_user_id_idx").on(t.userId),
  }),
);

/** Server-generated insights (weekly summaries, anomalies, AI tips). */
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: insightTypeEnum("type").notNull(),
    message: text("message").notNull(),
    dataJson: jsonb("data_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dismissed: boolean("dismissed").notNull().default(false),
  },
  (t) => ({
    userIdx: index("insights_user_id_idx").on(t.userId),
  }),
);

// ──────────────────────────────────────────────────────────────────────────
// Relations (for Drizzle's relational query API)
// ──────────────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  categories: many(categories),
  transactions: many(transactions),
  recurring: many(recurring),
  budgets: many(budgets),
  shortcuts: many(shortcuts),
  insights: many(insights),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  transactions: many(transactions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, { fields: [categories.userId], references: [users.id] }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "parent_child",
  }),
  children: many(categories, { relationName: "parent_child" }),
  transactions: many(transactions),
  budgets: many(budgets),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  recurring: one(recurring, {
    fields: [transactions.recurringId],
    references: [recurring.id],
  }),
}));

export const recurringRelations = relations(recurring, ({ one, many }) => ({
  user: one(users, { fields: [recurring.userId], references: [users.id] }),
  account: one(accounts, {
    fields: [recurring.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [recurring.categoryId],
    references: [categories.id],
  }),
  transactions: many(transactions),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  user: one(users, { fields: [budgets.userId], references: [users.id] }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const shortcutsRelations = relations(shortcuts, ({ one }) => ({
  user: one(users, { fields: [shortcuts.userId], references: [users.id] }),
  category: one(categories, {
    fields: [shortcuts.categoryId],
    references: [categories.id],
  }),
  account: one(accounts, {
    fields: [shortcuts.accountId],
    references: [accounts.id],
  }),
}));

export const insightsRelations = relations(insights, ({ one }) => ({
  user: one(users, { fields: [insights.userId], references: [users.id] }),
}));

// ──────────────────────────────────────────────────────────────────────────
// Inferred types for use in app code
// ──────────────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Recurring = typeof recurring.$inferSelect;
export type NewRecurring = typeof recurring.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Shortcut = typeof shortcuts.$inferSelect;
export type NewShortcut = typeof shortcuts.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;

/**
 * First-signup seed.
 *
 * Call `ensureUserProvisioned()` from your Clerk webhook handler (recommended)
 * or right after the first successful sign-in. It is idempotent — re-running
 * for an existing user is a no-op and will not duplicate categories.
 *
 *   import { ensureUserProvisioned } from "@/db/seed";
 *
 *   await ensureUserProvisioned({
 *     id: clerkUser.id,
 *     email: clerkUser.primaryEmailAddress!.emailAddress,
 *     name: clerkUser.fullName,
 *   });
 *
 * Server-only — uses the Drizzle client which talks Postgres directly.
 */
import { eq } from "drizzle-orm";
import { db } from "./client";
import { categories, users, type NewCategory } from "./schema";

/**
 * Default category set created on first signup.
 * Icons are lucide-react-native names; colors are tuned for the dark UI.
 */
export const DEFAULT_CATEGORIES: ReadonlyArray<
  Omit<NewCategory, "id" | "userId" | "parentId">
> = [
  { name: "Food",          icon: "utensils",        color: "#f97316", type: "expense" },
  { name: "Transport",     icon: "car",             color: "#3b82f6", type: "expense" },
  { name: "Shopping",      icon: "shopping-bag",    color: "#ec4899", type: "expense" },
  { name: "Bills",         icon: "receipt",         color: "#ef4444", type: "expense" },
  { name: "Entertainment", icon: "film",            color: "#a855f7", type: "expense" },
  { name: "Health",        icon: "heart-pulse",     color: "#14b8a6", type: "expense" },
  { name: "Salary",        icon: "wallet",          color: "#10b981", type: "income"  },
  { name: "Other",         icon: "more-horizontal", color: "#71717a", type: "expense" },
];

/** Insert the default categories for `userId`. */
export async function seedDefaultCategories(userId: string): Promise<void> {
  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })),
  );
}

/**
 * Insert the user row if missing, then seed default categories.
 * Safe to call repeatedly — only seeds on the first insert.
 */
export async function ensureUserProvisioned(args: {
  id: string;
  email: string;
  name?: string | null;
  currency?: string;
}): Promise<{ created: boolean }> {
  const inserted = await db
    .insert(users)
    .values({
      id: args.id,
      email: args.email,
      name: args.name ?? null,
      currency: args.currency ?? "PKR",
    })
    .onConflictDoNothing({ target: users.id })
    .returning({ id: users.id });

  const created = inserted.length > 0;
  if (created) {
    await seedDefaultCategories(args.id);
  }
  return { created };
}

/**
 * Re-seed defaults for a user (idempotent-ish: only inserts categories whose
 * name+type combo doesn't already exist). Useful as a "Restore defaults"
 * settings action.
 */
export async function restoreDefaultCategories(userId: string): Promise<number> {
  const existing = await db
    .select({ name: categories.name, type: categories.type })
    .from(categories)
    .where(eq(categories.userId, userId));

  const existingKeys = new Set(existing.map((c) => `${c.name}::${c.type}`));
  const missing = DEFAULT_CATEGORIES.filter(
    (c) => !existingKeys.has(`${c.name}::${c.type}`),
  );

  if (missing.length === 0) return 0;

  await db
    .insert(categories)
    .values(missing.map((c) => ({ ...c, userId })));
  return missing.length;
}

// ──────────────────────────────────────────────────────────────────────────
// CLI:  tsx db/seed.ts <userId> <email> [name]
// ──────────────────────────────────────────────────────────────────────────
const isCli =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isCli) {
  const [, , userId, email, ...nameParts] = process.argv;
  if (!userId || !email) {
    console.error("Usage: tsx db/seed.ts <clerkUserId> <email> [name]");
    process.exit(1);
  }
  ensureUserProvisioned({
    id: userId,
    email,
    name: nameParts.join(" ") || null,
  })
    .then(({ created }) => {
      console.log(
        created
          ? `✓ Provisioned ${userId} with ${DEFAULT_CATEGORIES.length} default categories`
          : `· ${userId} already exists — no changes`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

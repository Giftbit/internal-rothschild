SET SQL_SAFE_UPDATES = 0;

# Having a balance on generic codes represents a perContact balance. Why?
# - attachGenericAsNewValue sets the balance on the new value = generic code's balance
# - the migration of shared generic codes also copies over the balance since it doesn't make sense
#   to have "shared" balance.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_balance = balance,
    balance                               = NULL
WHERE isGenericCode = TRUE
  AND balance IS NOT NULL
  AND genericCodeOptions_perContact_balance IS NULL;

# It's less obvious that this is correct. this relies on usage and was verified with queries.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_usesRemaining = 1
WHERE isGenericCode = TRUE
  AND usesRemaining IS NOT NULL
  AND genericCodeOptions_perContact_usesRemaining IS NULL;

ALTER TABLE rothschild.`ContactValues`
  ADD migrated BOOLEAN NOT NULL DEFAULT 0;

SET SQL_SAFE_UPDATES = 1;
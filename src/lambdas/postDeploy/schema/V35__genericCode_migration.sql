SET SQL_SAFE_UPDATES = 0;

# balance on generic codes represent a perContact balance
# - attach generic as new value copied over the balance
# - the migration of shared generic codes also copied over the balance since it doesn't make sense
#   to have "shared" balance.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_balance = balance
WHERE isGenericCode = TRUE
  AND balance IS NOT NULL
  AND genericCodeOptions_perContact_balance IS NULL;

# It's less obvious that this is correct. this relies on usage and was verified with queries.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_usesRemaining = 1
WHERE isGenericCode = TRUE
  AND usesRemaining IS NOT NULL
  AND genericCodeOptions_perContact_usesRemaining IS NULL;

SET SQL_SAFE_UPDATES = 1;
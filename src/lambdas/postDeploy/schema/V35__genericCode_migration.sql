SET SQL_SAFE_UPDATES = 0;

# # balance on generic codes represent a perContact balance
# # - attach generic as new value copied over the balance
# # - the migration of shared generic codes also copied over the balance since it doesn't make sense
# #   to have "shared" balance.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_balance = balance
WHERE isGenericCode = TRUE
  AND balance IS NOT NULL
  AND genericCodeOptions_perContact_balance IS NULL;

# # It's less obvious that this is correct. this relies on usage and was verified with queries.
UPDATE rothschild.`Values`
SET genericCodeOptions_perContact_usesRemaining = 1
WHERE isGenericCode = TRUE
  AND usesRemaining IS NOT NULL
  AND genericCodeOptions_perContact_balance IS NULL
  AND genericCodeOptions_perContact_usesRemaining IS NULL;

# # LIMIT ATTACHES:
# # Now generic codes that have a balance and a usesRemaining (with no perContact.usesRemaining) need to have their balance
# # readjusted to correctly represent attaches remaining since their balance used to represent what they were worth to
# # recipients upon attach (due to being copied over).
UPDATE rothschild.`Values`
SET balance       = usesRemaining * genericCodeOptions_perContact_balance,
    usesRemaining = NULL
WHERE isGenericCode = TRUE
  AND usesRemaining IS NOT NULL
  AND balance IS NOT NULL
  AND genericCodeOptions_perContact_usesRemaining IS NULL
  AND genericCodeOptions_perContact_balance IS NOT NULL; -- this column will have been populated by the earlier query.

SET SQL_SAFE_UPDATES = 1;
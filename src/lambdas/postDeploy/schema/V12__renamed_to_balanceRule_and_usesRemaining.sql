ALTER TABLE rothschild.`Values`
  CHANGE uses usesRemaining INT,
  CHANGE valueRule balanceRule TEXT;

ALTER TABLE rothschild.`Programs`
  CHANGE fixedInitialUses fixedInitialUsesRemaining TEXT,
  CHANGE valueRule balanceRule TEXT;

ALTER TABLE rothschild.`Issuances`
  CHANGE uses usesRemaining INT,
  CHANGE valueRule balanceRule TEXT;
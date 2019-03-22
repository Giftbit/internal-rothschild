ALTER TABLE rothschild.`Values`
  ADD COLUMN balancePerContact INT(11) DEFAULT NULL,
  ADD COLUMN usesPerContact INT(11) DEFAULT NULL,
  ADD COLUMN attachedFromGenericValueId VARCHAR(64),
  ADD CONSTRAINT fk_Values_AttachedFromGenericValueId FOREIGN KEY (userId, attachedFromGenericValueId) REFERENCES rothschild.Values (userId, id);
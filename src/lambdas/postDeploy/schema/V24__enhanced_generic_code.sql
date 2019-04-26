ALTER TABLE rothschild.`Values`
  ADD COLUMN balancePerContact INT(11) DEFAULT NULL,
  ADD COLUMN usesPerContact INT(11) DEFAULT NULL,
  ADD COLUMN attachedFromGenericValueId VARCHAR(64),
  ADD CONSTRAINT fk_Values_AttachedFromGenericValueId FOREIGN KEY (userId, attachedFromGenericValueId) REFERENCES rothschild.Values (userId, id);

SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values` V
JOIN
(SELECT T.userId, LTS_Contact.valueId, LTS_GenericCode.valueId AS attachedFromGenericValueId
 FROM rothschild.`Transactions` T
        JOIN rothschild.`LightrailTransactionSteps` LTS_Contact ON LTS_Contact.transactionId = T.id
                                                                     AND LTS_Contact.userId = T.userId
        JOIN rothschild.`LightrailTransactionSteps` LTS_GenericCode ON LTS_GenericCode.transactionId = T.id
                                                                         AND LTS_GenericCode.userId = T.userId
 WHERE T.transactionType = 'attach'
   AND LTS_Contact.contactId IS NOT NULL
   AND LTS_GenericCode.contactId IS NULL) TT ON V.id = TT.valueId
                                                AND V.userId = TT.userId
SET V.attachedFromGenericValueId = TT.attachedFromGenericValueId
WHERE V.attachedFromGenericValueId IS NULL
  AND V.isGenericCode = FALSE;

SET SQL_SAFE_UPDATES = 1;
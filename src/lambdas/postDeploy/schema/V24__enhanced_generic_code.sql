ALTER TABLE rothschild.`Values`
  ADD COLUMN genericCodeOptions_perContact_balance INT(11) DEFAULT NULL,
  ADD COLUMN genericCodeOptions_perContact_usesRemaining INT(11) DEFAULT NULL,
  ADD COLUMN attachedFromValueId VARCHAR(64),
  ADD CONSTRAINT fk_Values_attachedFromValueId FOREIGN KEY (userId, attachedFromValueId) REFERENCES rothschild.Values (userId, id);

SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values` V
JOIN
(SELECT T.userId, LTS_Contact.valueId, LTS_GenericCode.valueId AS attachedFromValueId
 FROM rothschild.`Transactions` T
        JOIN rothschild.`LightrailTransactionSteps` LTS_Contact ON LTS_Contact.transactionId = T.id
                                                                     AND LTS_Contact.userId = T.userId
        JOIN rothschild.`LightrailTransactionSteps` LTS_GenericCode ON LTS_GenericCode.transactionId = T.id
                                                                         AND LTS_GenericCode.userId = T.userId
 WHERE T.transactionType = 'attach'
   AND LTS_Contact.contactId IS NOT NULL
   AND LTS_GenericCode.contactId IS NULL) TT ON V.id = TT.valueId
                                                AND V.userId = TT.userId
SET V.attachedFromValueId = TT.attachedFromValueId
WHERE V.attachedFromValueId IS NULL
  AND V.isGenericCode = FALSE;

UPDATE rothschild.`Transactions` T
SET T.lineItems = NULL
WHERE T.lineItems = 'null';

UPDATE rothschild.`Transactions` T
SET T.paymentSources = NULL
WHERE T.paymentSources = 'null';

UPDATE rothschild.`Transactions` T
SET T.metadata = NULL
WHERE T.metadata = 'null';

UPDATE rothschild.`Transactions` T
SET T.tax = NULL
WHERE T.tax = 'null';

SET SQL_SAFE_UPDATES = 1;
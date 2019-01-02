CREATE TABLE rothschild.ContactValues (
  userId      VARCHAR(64) NOT NULL,
  valueId     VARCHAR(64) NOT NULL,
  contactId   VARCHAR(64) NOT NULL,
  createdDate DATETIME    NOT NULL,
  PRIMARY KEY pk_ContactValues (userId, valueId, contactId),
  CONSTRAINT fk_ContactValues_Values FOREIGN KEY (userId, valueId) REFERENCES rothschild.Values (userId, id),
  CONSTRAINT fk_ContactValues_Contacts FOREIGN KEY (userId, contactId) REFERENCES rothschild.Contacts (userId, id)
);
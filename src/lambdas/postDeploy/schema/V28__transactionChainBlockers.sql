CREATE TABLE rothschild.TransactionChainBlockers
(
    userId        VARCHAR(64) NOT NULL,
    transactionId VARCHAR(64) NOT NULL,
    type          VARCHAR(64) NOT NULL,
    metadata      TEXT        NOT NULL,
    createdDate   DATETIME    NOT NULL,
    updatedDate   DATETIME    NOT NULL,
    PRIMARY KEY pk_TransactionChainBlockers (userId, transactionId),
    CONSTRAINT fk_TransactionChainBlockers_Transactions FOREIGN KEY (userId, transactionId) REFERENCES Transactions (userId, id)
);

# internal-rothschild
POC banking implementation

## Setting up a Postgres test env

`docker network create --driver bridge postgres-net`

`docker run --name rothschild --network postgres-net -e POSTGRES_PASSWORD=testpass -d postgres`

`docker run --name rothschild-pgadmin4 --network postgres-net -p 5050:5050 -d fenglc/pgadmin4`

- postgres
    - port: 5432
    - user: postgres
    - password: testpass
- pgadmin
    - http://localhost:5050/, 
    - user: pgadmin4@pgadmin.org
    - password: admin
    - add new server
        - name: Rothschild
        - host: rothschild
        - userId: postgres
        - password: testpass

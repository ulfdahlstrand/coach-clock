#!/bin/sh
# Skapar integrationstesternas databas i docker-compose-Postgres om den saknas (#78).
# Testerna droppar alla tabeller, så de får aldrig köra mot utvecklingsdatabasen.
set -eu

user="${POSTGRES_USER:-coach_clock}"
db="coach_clock_test"
compose="docker compose -f docker/docker-compose.yml"

if $compose exec -T postgres psql -U "$user" -d postgres -tAc \
  "select 1 from pg_database where datname = '$db'" | grep -q 1; then
  echo "Testdatabasen $db finns redan."
else
  $compose exec -T postgres createdb -U "$user" "$db"
  echo "Skapade testdatabasen $db."
fi

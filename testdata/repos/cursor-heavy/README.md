# Northwind storefront

The customer-facing shop for Northwind Traders.

## Architecture

The storefront is a Next.js app in app/ talking to a Django REST API in
api/. Orders flow from checkout through the payments worker in
workers/payments, which reconciles against Stripe webhooks. Product
search is served by a Meilisearch instance fed by the sync job in
workers/search-sync. Session state lives in Redis; everything durable is
Postgres.

## Contributing

See AGENTS.md for agent guidelines and CONTRIBUTING.md for the human
process.

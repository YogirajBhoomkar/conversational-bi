# Conversational BI server image. Build from the server folder:
#   docker build --build-arg BI_BUILD_SHA=$(git rev-parse --short HEAD) -t conversational-bi .
# Settings come from the environment (Helm values and Vault in GC); none are baked in. See docs/lift/GC-CONFIG.md.
# Mastra needs Node 22.13 or later.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build

FROM node:22-alpine
ENV NODE_ENV=production PORT=4111
WORKDIR /app
COPY --from=build --chown=node:node /app/.mastra/output ./.mastra/output
COPY --chown=node:node config ./config
ARG BI_BUILD_SHA=unknown
ENV BI_BUILD_SHA=$BI_BUILD_SHA
USER node
# Relative settings (BI_SPACES_FILE, BI_DOMAIN_RULES_FILE) resolve from /app, where config/ is.
WORKDIR /app/.mastra/output
EXPOSE 4111
CMD ["node", "index.mjs"]

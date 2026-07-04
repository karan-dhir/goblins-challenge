# Standalone grading service — built from the monorepo root context.
#   docker build -f grading-service/Dockerfile -t goblins-grading .
FROM node:22-slim
WORKDIR /repo
RUN npm i -g pnpm@9

# Workspace manifests + the two packages the service needs.
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY grading-service ./grading-service

RUN pnpm install --filter @goblins/grading-service...

WORKDIR /repo/grading-service
ENV PORT=3001
EXPOSE 3001
CMD ["pnpm", "start"]

# MentionForge is a remote Streamable HTTP MCP server at
# https://mentionforge.mentionforge.workers.dev/mcp (Cloudflare Worker).
# Glama's GitHub listing builds a container and speaks MCP over stdio.
# This image does not run the Worker. It runs mcp-remote as a stdio bridge
# to the hosted origin so initialize / tools/list / health / get_pricing work
# with no secrets. Paid research_mentions still settles $0.02 USDC on Base
# against the Worker (clients pay; Glama OSS hosting is free).
#
# Use CMD (not ENTRYPOINT). Glama wraps the image Cmd with mcp-proxy; an
# ENTRYPOINT-only image leaves Cmd empty and Deploy fails with
# "At least one command argument is required".
FROM node:22-alpine

RUN npm install -g mcp-remote@0.14.3

COPY --chown=node:node scripts/glama-stdio.mjs /home/node/glama-stdio.mjs

USER node
ENV HOME=/home/node

CMD ["node", "/home/node/glama-stdio.mjs"]

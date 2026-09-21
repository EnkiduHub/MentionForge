import type { ResearchRequest, ResearchResponse } from "../schemas/research";
import { SAMPLE_QUERY } from "./constants";

/** Snapshot of a real sandbox call on production (query "Cloudflare Workers", platforms web, $0). */
export const SAMPLE_REQUEST: ResearchRequest = {
  query: SAMPLE_QUERY,
  platforms: ["web"],
  timeframe: "7d",
  limit: 12,
  include_summary: true,
  language: "en",
};

export const EXAMPLE_RESPONSE: ResearchResponse = {
  "query": "Cloudflare Workers",
  "timeframe": "7d",
  "volume": {
    "total": 11,
    "by_platform": {
      "x": 0,
      "reddit": 0,
      "web": 11,
      "reviews": 0,
      "news": 0
    },
    "trend": [
      {
        "t": "2026-09-20T00:00:00.000Z",
        "count": 11
      }
    ]
  },
  "sentiment": {
    "overall": -0.016,
    "positive": 0,
    "neutral": 90.9,
    "negative": 9.1,
    "distribution": {
      "positive": 0,
      "neutral": 90.9,
      "negative": 9.1,
      "by_platform": {
        "web": 11
      }
    },
    "by_platform": {
      "web": -0.016
    }
  },
  "themes": [
    {
      "theme": "network",
      "count": 4,
      "examples": [
        "Cloudflare, Inc., is an American technology company headquartered in San Francisco, California, that provides a range of internet services, ",
        "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers."
      ]
    },
    {
      "theme": "serverless",
      "count": 4,
      "examples": [
        "Cloudflare Workers - Global Serverless Functions Platform — Workers enables you to instantly deploy to all 330+ cities, or gradually roll ou",
        "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers."
      ]
    },
    {
      "theme": "global",
      "count": 3,
      "examples": [
        "Cloudflare Workers - Global Serverless Functions Platform — Workers enables you to instantly deploy to all 330+ cities, or gradually roll ou",
        "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers."
      ]
    },
    {
      "theme": "deploy",
      "count": 3,
      "examples": [
        "Cloudflare Workers - Global Serverless Functions Platform — Workers enables you to instantly deploy to all 330+ cities, or gradually roll ou",
        "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers."
      ]
    },
    {
      "theme": "docs",
      "count": 3,
      "examples": [
        "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers.",
        "Pricing · Cloudflare Workers docs — Users are advised to move to the Workers Standard usage model. Changing the usage model only affects billable usage, and has no technical implications.",
      ]
    },
    {
      "theme": "code",
      "count": 3,
      "examples": [
        "Posts tagged \"Cloudflare Workers\" — Cloudflare Blog — Workers now enables Node.js compatibility by default, supports applications up to 64 mebibytes, and adds a URL-based module registry with import.meta, lazy compilation, shared code caches, and clearer errors.",
        "What are Cloudflare Workers? — Cloudflare Workers, a serverless function by Cloudflare, runs on an edge network and is written in JavaScript.",
      ]
    },
    {
      "theme": "javascript",
      "count": 2,
      "examples": [
        "Cloudflare Workers — JavaScript edge runtime environment",
        "What are Cloudflare Workers? — Cloudflare Workers, a serverless function by Cloudflare, runs on an edge network and is written in JavaScript.",
      ]
    },
    {
      "theme": "edge",
      "count": 2,
      "examples": [
        "Cloudflare Workers — JavaScript edge runtime environment",
        "What are Cloudflare Workers? — Cloudflare Workers, a serverless function by Cloudflare, runs on an edge network and is written in JavaScript.",
      ]
    }
  ],
  "mentions": [
    {
      "id": "mf_f3a95eba",
      "platform": "web",
      "url": "https://www.cloudflare.com/developer-platform/products/workers/",
      "author": "official",
      "timestamp": "2026-09-20T04:04:57.900Z",
      "text": "Cloudflare Workers official site",
      "engagement": 9,
      "sentiment": 0,
      "intent": "other",
      "relevance": 1
    },
    {
      "id": "mf_ff71f1de",
      "platform": "web",
      "url": "https://en.wikipedia.org/wiki/Cloudflare",
      "author": "wikipedia",
      "timestamp": "2026-09-20T04:04:57.978Z",
      "text": "Cloudflare, Inc., is an American technology company headquartered in San Francisco, California, that provides a range of internet services, including content delivery network (CDN) services, cloud cybersecurity, DDoS mitigation, and ICANN-accredited domain registration. The company's services act primarily as a reverse proxy between website visitors and a customer's hosting provider, improving performance and protecting against malicious traffic.",
      "engagement": 8,
      "sentiment": 0
    },
    {
      "id": "mf_6ea7730e",
      "platform": "web",
      "url": "https://www.wikidata.org/entity/Q131417404",
      "author": "wikidata",
      "timestamp": "2026-09-20T04:04:57.606Z",
      "text": "Cloudflare Workers — JavaScript edge runtime environment",
      "engagement": 5,
      "sentiment": 0
    },
    {
      "id": "mf_10a6074f",
      "platform": "web",
      "url": "https://www.cloudflare.com/products/workers/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Cloudflare Workers - Global Serverless Functions Platform — Workers enables you to instantly deploy to all 330+ cities, or gradually roll out changes to a percentage of your users . If errors spike up, roll back when you need. ... Serverless functions that run everywhere, instantly.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_62e7ae18",
      "platform": "web",
      "url": "https://developers.cloudflare.com/workers/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Overview · Cloudflare Workers docs — Build and deploy serverless applications across Cloudflare's global network with Workers.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_fdebc7e1",
      "platform": "web",
      "url": "https://developers.cloudflare.com/workers/platform/pricing/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Pricing · Cloudflare Workers docs — Users are advised to move to the Workers Standard usage model. Changing the usage model only affects billable usage, and has no technical implications. ... In the Cloudflare dashboard, go to the Workers & Pages page.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_c7be7972",
      "platform": "web",
      "url": "https://blog.cloudflare.com/tag/workers/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Posts tagged \"Cloudflare Workers\" — Cloudflare Blog — Workers now enables Node.js compatibility by default, supports applications up to 64 mebibytes, and adds a URL-based module registry with import.meta, lazy compilation, shared code caches, and clearer errors. ... We migrated the Cloudflare Blog to EmDash to prove our stack at massive scale.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_fe5c2153",
      "platform": "web",
      "url": "https://developers.cloudflare.com/workers-ai/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Overview · Cloudflare Workers AI docs — Run machine learning models, powered by serverless GPUs, on Cloudflare's global network . ... Workers AI allows you to run AI models in a serverless way, without having to worry about scaling, maintaining, or paying for unused infrastructure.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_aa540137",
      "platform": "web",
      "url": "https://www.reddit.com/r/node/comments/15qo28j/can_anyone_say_me_some_pro_and_cons_of_cloudflare/",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "r/node on Reddit: Can anyone say me some pro and cons of cloudflare workers — Haha, better late than never! To clarify, I meant impractical for larger, more tangled real-world apps with tons of dependencies, but for small-scale APIs or solo dev stuff, Cloudflare Workers are absolutely viable — I've been running a few of my own projects fully on them without issues.",
      "engagement": 3,
      "sentiment": -0.2,
      "intent": "complaint",
      "aspects": ["reliability"],
      "relevance": 0.8
    },
    {
      "id": "mf_6fce2cdb",
      "platform": "web",
      "url": "https://www.macrometa.com/articles/what-are-cloudflare-workers",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "What are Cloudflare Workers? — Cloudflare Workers, a serverless function by Cloudflare , runs on an edge network and is written in JavaScript. When workers are deployed, the code written is distributed across all the edge locations offered by Cloudflare, with minimal latency.",
      "engagement": 3,
      "sentiment": 0
    },
    {
      "id": "mf_84cd605b",
      "platform": "web",
      "url": "https://workers.cloudflare.com/playground",
      "author": "web",
      "timestamp": "2026-09-20T04:04:58.651Z",
      "text": "Cloudflare Workers Playground — Build, preview, and deploy your Workers from the Wrangler command line interface (CLI). Once set up, you’ll be able to quickly iterate on Worker code and configuration from your local development environment.Using Wrangler CLI ... You'll be asked to deploy via the create-cloudflare CLI.",
      "engagement": 3,
      "sentiment": 0
    }
  ],
  "summary": "Cloudflare Workers: 11 fused mentions in the selected window, sentiment mixed-to-neutral (-0.02). Themes: network, serverless, global. Coverage is mixed across sources; weight cited URLs over any single platform. High-engagement threads are the fastest sentiment lever.",
  "citations": [
    {
      "url": "https://en.wikipedia.org/wiki/Cloudflare",
      "title": "Cloudflare",
      "source": "wikipedia",
      "accessed_at": "2026-09-20T04:04:57.978Z"
    },
    {
      "url": "https://www.wikidata.org/entity/Q131417404",
      "title": "Cloudflare Workers",
      "source": "wikidata",
      "accessed_at": "2026-09-20T04:04:57.606Z"
    },
    {
      "url": "https://www.cloudflare.com/developer-platform/products/workers/",
      "title": "Cloudflare Workers official site",
      "source": "wikidata-official",
      "accessed_at": "2026-09-20T04:04:57.900Z"
    },
    {
      "url": "https://www.cloudflare.com/products/workers/",
      "title": "Cloudflare Workers - Global Serverless Functions Platform",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://developers.cloudflare.com/workers/",
      "title": "Overview · Cloudflare Workers docs",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://developers.cloudflare.com/workers/platform/pricing/",
      "title": "Pricing · Cloudflare Workers docs",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://blog.cloudflare.com/tag/workers/",
      "title": "Posts tagged \"Cloudflare Workers\" — Cloudflare Blog",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://developers.cloudflare.com/workers-ai/",
      "title": "Overview · Cloudflare Workers AI docs",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://www.reddit.com/r/node/comments/15qo28j/can_anyone_say_me_some_pro_and_cons_of_cloudflare/",
      "title": "r/node on Reddit: Can anyone say me some pro and cons of cloudflare workers",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://www.macrometa.com/articles/what-are-cloudflare-workers",
      "title": "What are Cloudflare Workers?",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    },
    {
      "url": "https://workers.cloudflare.com/playground",
      "title": "Cloudflare Workers Playground",
      "source": "brave",
      "accessed_at": "2026-09-20T04:04:58.651Z"
    }
  ],
  "share_of_voice": [
    { "brand": "Cloudflare Workers", "mentions": 9, "engagement": 40, "share": 0.8182 },
    { "brand": "other", "mentions": 2, "engagement": 6, "share": 0.1818 }
  ],
  "signals": {
    "risk": "low",
    "spike": false,
    "reasons": ["no spike or negative concentration"]
  },
  "meta": {
    "sources_used": [
      "web"
    ],
    "confidence": 0.725,
    "as_of": "2026-09-20T04:04:59.148Z",
    "request_id": "example-snapshot",
    "latency_ms": 2426,
    "billing": {
      "amount_usdc": "0",
      "tx_hash": null,
      "free_trial": true
    },
    "next_queries": [
      "Cloudflare Workers vs competitors",
      "Cloudflare Workers complaints",
      "Cloudflare Workers last 24 hours"
    ],
    "freshness": "cached"
  }
};

import { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Env } from './types.js';
import { AuthMiddleware } from './middleware.js';
import { StravaApiProxy } from './middleware.js';

// MCP Protocol types
interface MCPRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id?: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface MCPNotification {
  jsonrpc: string;
  method: string;
  params?: any;
}

// MCP Server implementation for Strava
export class SportMCPServer {
  private env: Env;
  private authMiddleware: AuthMiddleware;

  constructor(env: Env) {
    this.env = env;
    this.authMiddleware = new AuthMiddleware(env);
  }

  // Handle MCP requests
  async handleMCPRequest(request: MCPRequest, context: any): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);
        
        case 'tools/list':
          return this.handleToolsList(request);
        
        case 'tools/call':
          return await this.handleToolCall(request, context);
        
        case 'notifications/initialized':
          return { jsonrpc: '2.0', id: request.id, result: {} };
        
                default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: 'Method not found',
              data: { method: request.method }
            }
          };
      }
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: { message: error.message }
        }
      };
    }
  }

  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'SportMCP',
          version: '1.0.0'
        }
      }
    };
  }

  private handleToolsList(request: MCPRequest): MCPResponse {
    // Always include the authentication and welcome tools first
    const tools = [
      {
        name: 'welcome-strava-mcp',
        description: 'Welcome message and setup instructions for new users. Use this first to help users get started.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'authenticate-strava',
        description: 'Get the Strava OAuth authentication URL to connect your account',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-recent-activities',
        description: 'Get recent Strava activities for the authenticated athlete',
        inputSchema: {
          type: 'object',
          properties: {
            per_page: {
              type: 'number',
              description: 'Number of activities to retrieve (max 200)',
              default: 30
            }
          }
        }
      },
      {
        name: 'get-athlete-profile',
        description: 'Get the authenticated athlete profile information',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-athlete-stats',
        description: 'Get athlete activity statistics (recent, YTD, all-time)',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get-activity-details',
        description: 'Get detailed information about a specific activity',
        inputSchema: {
          type: 'object',
          properties: {
            activityId: {
              type: 'number',
              description: 'The unique identifier of the activity'
            }
          },
          required: ['activityId']
        }
      },
      {
        name: 'get-activity-streams',
        description: 'Get time-series data streams from a Strava activity',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: 'The Strava activity identifier'
            },
            types: {
              type: 'string',
              description: 'Comma-separated list of stream types',
              default: 'time,distance,heartrate,cadence,watts'
            },
            resolution: {
              type: 'string',
              description: 'Data resolution',
              enum: ['low', 'medium', 'high'],
              default: 'high'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'get-starred-segments',
        description: 'List the segments starred by the authenticated athlete',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'explore-segments',
        description: 'Explore popular segments in a geographical area',
        inputSchema: {
          type: 'object',
          properties: {
            bounds: {
              type: 'string',
              description: 'Comma-separated: south_west_lat,south_west_lng,north_east_lat,north_east_lng'
            },
            activity_type: {
              type: 'string',
              enum: ['running', 'riding'],
              description: 'Filter by activity type'
            }
          },
          required: ['bounds']
        }
      },
      {
        name: 'get-athlete-routes',
        description: 'List routes created by the authenticated athlete',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'Page number for pagination',
              default: 1
            },
            per_page: {
              type: 'number',
              description: 'Number of routes per page',
              default: 30
            }
          }
        }
      },
      {
        name: 'get-activity-laps',
        description: 'Get the lap splits for a specific Strava activity. Essential for analyzing interval training sessions, tempo runs, and structured workouts.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava activity ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get-activity-kudos',
        description: 'List the athletes who have kudoed a specific Strava activity.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava activity ID' },
            per_page: { type: 'number', description: 'Results per page (max 200)', default: 30 }
          },
          required: ['id']
        }
      },
      {
        name: 'get-activity-comments',
        description: 'List the comments on a specific Strava activity.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava activity ID' },
            per_page: { type: 'number', description: 'Results per page (max 200)', default: 30 }
          },
          required: ['id']
        }
      },
      {
        name: 'get-athlete-zones',
        description: 'Get the heart rate and power training zones for the authenticated athlete. Useful for understanding training intensity targets.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get-athlete-clubs',
        description: 'List the clubs the authenticated athlete is a member of.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get-club',
        description: 'Get details about a specific Strava club, including member count, sport type, and location.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava club ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get-gear',
        description: 'Get details about a specific piece of gear (bike or shoes), including total mileage logged. Great for tracking equipment wear.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The gear ID (e.g. b123456 for bikes, g123456 for shoes) — found on the athlete profile' }
          },
          required: ['id']
        }
      },
      {
        name: 'get-segment',
        description: 'Get detailed information about a specific Strava segment, including distance, elevation, grade, and the KOM/QOM time.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava segment ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get-segment-efforts',
        description: 'List all of the authenticated athlete\'s recorded efforts on a specific segment, sorted by start date. Shows your personal history and progression on that segment.',
        inputSchema: {
          type: 'object',
          properties: {
            segment_id: { type: 'number', description: 'The Strava segment ID' },
            per_page: { type: 'number', description: 'Results per page (max 200)', default: 30 }
          },
          required: ['segment_id']
        }
      },
      {
        name: 'get-segment-effort',
        description: 'Get detailed information about a specific segment effort, including elapsed time, average HR, average watts, and whether it was a PR.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The segment effort ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get-route',
        description: 'Get details about a specific route, including distance, elevation gain, and estimated moving time.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'The Strava route ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'bulk-update-activities',
        description: 'Apply the same edit to many activities at once. Filter activities by date range, sport type, or name pattern; patch can set name (literal or templated), description, commute flag, trainer flag, hide_from_home, gear_id, or sport_type. Always preview with dry_run=true first (the default).',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'object',
              description: 'Activities matching ALL specified filter fields will be updated.',
              properties: {
                before: { type: 'number', description: 'Unix seconds: only activities started before this time' },
                after: { type: 'number', description: 'Unix seconds: only activities started after this time' },
                sport_type: { type: 'string', description: 'Exact Strava sport_type (e.g. Run, Ride, TrailRun, GravelRide)' },
                name_contains: { type: 'string', description: 'Case-insensitive substring match on activity name' },
                name_regex: { type: 'string', description: 'JS regex on activity name (alternative to name_contains)' }
              }
            },
            patch: {
              type: 'object',
              description: 'Fields to set on matching activities. Provide one or more.',
              properties: {
                name: { type: 'string', description: 'Literal new name' },
                name_template: { type: 'string', description: 'Template with placeholders {sport_type} {date} {distance_km} — e.g. "Recovery {sport_type} {date}"' },
                description: { type: 'string' },
                commute: { type: 'boolean' },
                trainer: { type: 'boolean' },
                hide_from_home: { type: 'boolean' },
                gear_id: { type: 'string', description: 'Bike or shoe id from get-athlete-profile; pass "none" to clear' },
                sport_type: { type: 'string' }
              }
            },
            dry_run: { type: 'boolean', default: true, description: 'If true (default), return what WOULD be changed without writing. Set false to actually update.' },
            max_activities: { type: 'number', default: 50, description: 'Safety cap on how many activities can be touched in one call (max 200).' }
          },
          required: ['filter', 'patch']
        }
      },
      {
        name: 'weekly-summary',
        description: 'Rolling per-week aggregates: count, total distance, moving time, elevation, average heart rate. Grouped by sport_type within each ISO week (Monday start). Cheaper than calling get-recent-activities + summing yourself.',
        inputSchema: {
          type: 'object',
          properties: {
            weeks_back: { type: 'number', default: 4, description: 'How many weeks of history to summarize (max 26).' },
            sport_types: { type: 'array', items: { type: 'string' }, description: 'Optional sport-type filter, e.g. ["Run","Ride"]. Default: include all sport types found.' }
          }
        }
      },
      {
        name: 'streak-status',
        description: 'Current consecutive-day activity streak and longest streak in the lookback window. Pass sport_type to scope (e.g. only running days count); omit for any-activity streaks.',
        inputSchema: {
          type: 'object',
          properties: {
            sport_type: { type: 'string', description: 'Optional. e.g. Run, Ride. Omit to count any activity.' },
            lookback_days: { type: 'number', default: 365, description: 'How far back to search for the longest streak (max 730).' }
          }
        }
      }
    ];

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools }
    };
  }

  private async handleToolCall(request: MCPRequest, context: any): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;
    const baseUrl = context.baseUrl || 'https://your-worker-name.your-subdomain.workers.dev'; // fallback
    
    // Check if user is authenticated
    if (!context.session || !context.token) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: `🔐 **Authentication Required**\n\nTo use ${name}, please connect your Strava account first:\n\n👉 [Authenticate with Strava](${baseUrl}/auth)\n\nThis will allow the AI to access your Strava data securely. Each user authenticates with their own account - your data stays private!\n\nAfter authentication, try your request again.`
            }
          ]
        }
      };
    }

    try {
      let result;
      
      switch (name) {
        case 'welcome-strava-mcp':
          const isAuthenticated = !!(context.session && context.token);
          if (isAuthenticated) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `🎉 **Welcome back, ${context.session.athlete.firstname}!**\n\nYour Strava account is connected and ready to use with SportMCP.\n\n🏃 **Try asking:**\n• "Show me my last 10 activities"\n• "Break down the laps on my interval run"\n• "What are my heart rate and power zones?"\n• "How many miles are on my shoes?"\n• "Show my history on segment 12345"\n• "Find climbs near Boulder, Colorado"\n• "What clubs am I a member of?"\n\n📊 **21 tools:** activities, laps, streams, kudos, comments, segments, segment efforts, routes, clubs, gear, zones & stats — all powered by Strava.`
                  }
                ]
              }
            };
          } else {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `👋 **Welcome to SportMCP** — your Strava data for any AI agent.\n\nSportMCP works with **Claude Desktop, Cursor, Windsurf, Cline, Continue.dev, Poke**, and any other MCP-compatible client.\n\n🔐 **Quick Setup:**\n1. Visit [${baseUrl}/auth](${baseUrl}/auth) and connect your Strava account\n2. Copy your personal MCP URL from the dashboard\n3. Paste it into your AI agent's MCP settings\n\n**Config format (works in all major clients):**\n\`\`\`json\n{\n  "mcpServers": {\n    "sportmcp": {\n      "url": "${baseUrl}/mcp?token=YOUR_TOKEN"\n    }\n  }\n}\n\`\`\`\n\n🏃 **Once connected, you can ask:**\n• "Show me my recent activities"\n• "Break down the laps on my last run"\n• "What are my heart rate zones?"\n• "How many miles are on my gear?"\n• "Find popular segments near me"\n\n📊 **21 tools:** activities, laps, streams, segments, routes, clubs, gear, zones & stats — powered by Strava.\n\n🔒 **Privacy:** Your personal URL is unique to you. Data is fetched live, never stored or shared.`
                  }
                ]
              }
            };
          }
        
        case 'authenticate-strava':
          // Generate a unique user session ID for this conversation
          const userSessionId = `user_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Store the user session temporarily
          await this.env.STRAVA_SESSIONS.put(`pending_auth:${userSessionId}`, JSON.stringify({
            created_at: Math.floor(Date.now() / 1000),
            status: 'pending'
          }), { expirationTtl: 1800 }); // 30 minutes
          
          const authUrl = `${baseUrl}/auth?session=${userSessionId}`;
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `🔐 **Strava Authentication Required**\n\nTo access your Strava data, please authenticate first:\n\n👉 [Connect your Strava account](${authUrl})\n\n📄 **Instructions:**\n1. Click the link above to authenticate with Strava\n2. After authentication, come back and try your request again\n3. No need to update any URLs - just ask for your Strava data!\n\n🔄 **Then try:** "Show me my recent Strava activities"`
                }
              ],
              userSession: userSessionId // Pass this to the client for future requests
            }
          };
        
        case 'get-recent-activities':
          const perPage = args?.per_page || 30;
          result = await StravaApiProxy.fetchJson('/athlete/activities', context.token, {
            params: { per_page: Math.min(perPage, 200) }
          });
          break;
        
        case 'get-athlete-profile':
          result = await StravaApiProxy.fetchJson('/athlete', context.token);
          break;
        
        case 'get-athlete-stats':
          result = await StravaApiProxy.fetchJson(`/athletes/${context.session.athlete_id}/stats`, context.token);
          break;
        
        case 'get-activity-details':
          if (!args?.activityId) {
            throw new Error('Activity ID is required');
          }
          result = await StravaApiProxy.fetchJson(`/activities/${args.activityId}`, context.token);
          break;
        
        case 'get-activity-streams':
          if (!args?.id) {
            throw new Error('Activity ID is required');
          }
          const types = args.types || 'time,distance,heartrate,cadence,watts';
          const resolution = args.resolution || 'high';
          result = await StravaApiProxy.fetchJson(`/activities/${args.id}/streams`, context.token, {
            params: {
              keys: types,
              key_by_type: 'true',
              resolution
            }
          });
          break;
        
        case 'get-starred-segments':
          result = await StravaApiProxy.fetchJson('/segments/starred', context.token);
          break;
        
        case 'explore-segments':
          if (!args?.bounds) {
            throw new Error('Bounds parameter is required');
          }
          const exploreParams: any = { bounds: args.bounds };
          if (args.activity_type) exploreParams.activity_type = args.activity_type;
          result = await StravaApiProxy.fetchJson('/segments/explore', context.token, {
            params: exploreParams
          });
          break;
        
        case 'get-athlete-routes':
          const routeParams: any = {};
          if (args?.page) routeParams.page = args.page;
          if (args?.per_page) routeParams.per_page = Math.min(args.per_page, 200);
          result = await StravaApiProxy.fetchJson(`/athletes/${context.session.athlete_id}/routes`, context.token, {
            params: routeParams
          });
          break;

        case 'bulk-update-activities': {
          const filter = (args?.filter ?? {}) as any;
          const patch = (args?.patch ?? {}) as any;
          const dryRun = args?.dry_run !== false;
          const maxActivities = Math.min(args?.max_activities ?? 50, 200);

          const fetchParams: any = { per_page: Math.min(maxActivities * 2, 200) };
          if (filter.before) fetchParams.before = filter.before;
          if (filter.after) fetchParams.after = filter.after;

          const acts: any[] = await StravaApiProxy.fetchJson('/athlete/activities', context.token, { params: fetchParams });

          let nameRegex: RegExp | null = null;
          if (filter.name_regex) {
            try { nameRegex = new RegExp(filter.name_regex); }
            catch (e: any) {
              result = { error: `Invalid name_regex: ${e?.message}` };
              break;
            }
          }

          const matched = (Array.isArray(acts) ? acts : []).filter((a: any) => {
            if (filter.sport_type && a.sport_type !== filter.sport_type) return false;
            if (filter.name_contains && !(a.name ?? '').toLowerCase().includes(String(filter.name_contains).toLowerCase())) return false;
            if (nameRegex && !nameRegex.test(a.name ?? '')) return false;
            return true;
          }).slice(0, maxActivities);

          const renderTemplate = (tpl: string, a: any) => tpl
            .replace(/\{sport_type\}/g, a.sport_type ?? '')
            .replace(/\{date\}/g, (a.start_date_local ?? '').slice(0, 10))
            .replace(/\{distance_km\}/g, ((a.distance ?? 0) / 1000).toFixed(1));

          const updates: any[] = [];
          for (const a of matched) {
            const body: any = {};
            if (patch.name !== undefined) body.name = patch.name;
            if (patch.name_template !== undefined) body.name = renderTemplate(patch.name_template, a);
            if (patch.description !== undefined) body.description = patch.description;
            if (patch.commute !== undefined) body.commute = patch.commute;
            if (patch.trainer !== undefined) body.trainer = patch.trainer;
            if (patch.hide_from_home !== undefined) body.hide_from_home = patch.hide_from_home;
            if (patch.gear_id !== undefined) body.gear_id = patch.gear_id;
            if (patch.sport_type !== undefined) body.sport_type = patch.sport_type;

            if (Object.keys(body).length === 0) {
              updates.push({ id: a.id, name: a.name, skipped: 'empty patch' });
              continue;
            }

            if (dryRun) {
              updates.push({ id: a.id, name: a.name, would_set: body });
            } else {
              try {
                await StravaApiProxy.fetchJson(`/activities/${a.id}`, context.token, { method: 'PUT', body });
                updates.push({ id: a.id, name: a.name, applied: body });
              } catch (e: any) {
                updates.push({ id: a.id, name: a.name, error: e?.message ?? String(e) });
              }
            }
          }
          result = {
            matched_count: matched.length,
            total_scanned: Array.isArray(acts) ? acts.length : 0,
            dry_run: dryRun,
            updates
          };
          break;
        }

        case 'weekly-summary': {
          const weeksBack = Math.min(args?.weeks_back ?? 4, 26);
          const sportTypes: string[] | null = Array.isArray(args?.sport_types) && args.sport_types.length > 0 ? args.sport_types : null;
          const afterSec = Math.floor(Date.now() / 1000) - weeksBack * 7 * 86400;

          const acts: any[] = [];
          let page = 1;
          while (page <= 5) {
            const batch = await StravaApiProxy.fetchJson('/athlete/activities', context.token, {
              params: { after: afterSec, per_page: 200, page }
            });
            if (!Array.isArray(batch) || batch.length === 0) break;
            acts.push(...batch);
            if (batch.length < 200) break;
            page++;
          }

          const buckets: Record<string, Record<string, any>> = {};
          for (const a of acts) {
            if (sportTypes && !sportTypes.includes(a.sport_type)) continue;
            const d = new Date(a.start_date);
            const day = d.getUTCDay();
            const diff = (day === 0 ? -6 : 1 - day);
            const monday = new Date(d);
            monday.setUTCDate(d.getUTCDate() + diff);
            const wk = monday.toISOString().slice(0, 10);
            const st = a.sport_type ?? 'Unknown';
            buckets[wk] ??= {};
            buckets[wk][st] ??= { count: 0, distance_m: 0, moving_time_s: 0, elevation_m: 0, heartrate_sum: 0, heartrate_count: 0 };
            const b = buckets[wk][st];
            b.count++;
            b.distance_m += a.distance ?? 0;
            b.moving_time_s += a.moving_time ?? 0;
            b.elevation_m += a.total_elevation_gain ?? 0;
            if (a.has_heartrate && a.average_heartrate) {
              b.heartrate_sum += a.average_heartrate;
              b.heartrate_count++;
            }
          }
          const weeks = Object.entries(buckets)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([wk, sports]) => ({
              week_starting: wk,
              sports: Object.fromEntries(Object.entries(sports).map(([st, b]: [string, any]) => [st, {
                count: b.count,
                distance_km: Math.round(b.distance_m / 100) / 10,
                moving_time_min: Math.round(b.moving_time_s / 60),
                elevation_m: Math.round(b.elevation_m),
                avg_heartrate: b.heartrate_count > 0 ? Math.round(b.heartrate_sum / b.heartrate_count) : null
              }]))
            }));
          result = { weeks_requested: weeksBack, activities_scanned: acts.length, weeks };
          break;
        }

        case 'streak-status': {
          const sportType = args?.sport_type;
          const lookbackDays = Math.min(args?.lookback_days ?? 365, 730);
          const afterSec = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

          const acts: any[] = [];
          let page = 1;
          while (page <= 10) {
            const batch = await StravaApiProxy.fetchJson('/athlete/activities', context.token, {
              params: { after: afterSec, per_page: 200, page }
            });
            if (!Array.isArray(batch) || batch.length === 0) break;
            acts.push(...batch);
            if (batch.length < 200) break;
            page++;
          }

          const days = new Set<string>();
          for (const a of acts) {
            if (sportType && a.sport_type !== sportType) continue;
            const day = (a.start_date_local ?? a.start_date ?? '').slice(0, 10);
            if (day) days.add(day);
          }
          const sorted = [...days].sort();

          let longest = 0, longestStart = '', longestEnd = '';
          let runStart = '', runEnd = '', runLen = 0;
          for (const day of sorted) {
            if (!runStart) {
              runStart = day; runEnd = day; runLen = 1;
            } else {
              const prev = new Date(runEnd + 'T00:00:00Z');
              prev.setUTCDate(prev.getUTCDate() + 1);
              const expected = prev.toISOString().slice(0, 10);
              if (day === expected) {
                runEnd = day; runLen++;
              } else {
                if (runLen > longest) { longest = runLen; longestStart = runStart; longestEnd = runEnd; }
                runStart = day; runEnd = day; runLen = 1;
              }
            }
          }
          if (runLen > longest) { longest = runLen; longestStart = runStart; longestEnd = runEnd; }

          const today = new Date().toISOString().slice(0, 10);
          let current = 0;
          const cur = new Date(today + 'T00:00:00Z');
          while (true) {
            const k = cur.toISOString().slice(0, 10);
            if (days.has(k)) {
              current++;
              cur.setUTCDate(cur.getUTCDate() - 1);
            } else {
              break;
            }
          }

          result = {
            sport_type: sportType ?? 'any',
            lookback_days: lookbackDays,
            activities_scanned: acts.length,
            matching_days: sorted.length,
            current_streak_days: current,
            longest_streak_days: longest,
            longest_streak_start: longestStart || null,
            longest_streak_end: longestEnd || null,
            last_activity_date: sorted[sorted.length - 1] ?? null
          };
          break;
        }

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: 'Tool not found',
              data: { tool: name }
            }
          };
      }

      // Append "View on Strava" links where applicable (Strava brand requirement)
      let stravaLinks = '';
      if (name === 'get-recent-activities' && Array.isArray(result)) {
        stravaLinks = '\n\n---\n**View on Strava:**\n' +
          result.slice(0, 10).map((a: any) =>
            `• [${a.name || 'Activity'}](https://www.strava.com/activities/${a.id})`
          ).join('\n');
      } else if (name === 'get-activity-details' && result?.id) {
        stravaLinks = `\n\n[View on Strava](https://www.strava.com/activities/${result.id})`;
      } else if (name === 'get-activity-streams' && args?.id) {
        stravaLinks = `\n\n[View on Strava](https://www.strava.com/activities/${args.id})`;
      } else if (name === 'get-athlete-profile' && result?.id) {
        stravaLinks = `\n\n[View profile on Strava](https://www.strava.com/athletes/${result.id})`;
      } else if (name === 'get-athlete-routes' && Array.isArray(result)) {
        stravaLinks = '\n\n---\n**View on Strava:**\n' +
          result.slice(0, 10).map((r: any) =>
            `• [${r.name || 'Route'}](https://www.strava.com/routes/${r.id})`
          ).join('\n');
      } else if (name === 'get-starred-segments' && Array.isArray(result)) {
        stravaLinks = '\n\n---\n**View on Strava:**\n' +
          result.slice(0, 10).map((s: any) =>
            `• [${s.name || 'Segment'}](https://www.strava.com/segments/${s.id})`
          ).join('\n');
      } else if (name === 'explore-segments' && result?.segments) {
        stravaLinks = '\n\n---\n**View on Strava:**\n' +
          result.segments.slice(0, 10).map((s: any) =>
            `• [${s.name || 'Segment'}](https://www.strava.com/segments/${s.id})`
          ).join('\n');
      } else if ((name === 'get-activity-laps' || name === 'get-activity-kudos' || name === 'get-activity-comments') && args?.id) {
        stravaLinks = `\n\n[View activity on Strava](https://www.strava.com/activities/${args.id})`;
      } else if (name === 'get-segment' && result?.id) {
        stravaLinks = `\n\n[View segment on Strava](https://www.strava.com/segments/${result.id})`;
      } else if (name === 'get-segment-efforts' && args?.segment_id) {
        stravaLinks = `\n\n[View segment on Strava](https://www.strava.com/segments/${args.segment_id})`;
      } else if (name === 'get-segment-effort' && result?.activity?.id) {
        stravaLinks = `\n\n[View activity on Strava](https://www.strava.com/activities/${result.activity.id})`;
      } else if (name === 'get-route' && result?.id) {
        stravaLinks = `\n\n[View route on Strava](https://www.strava.com/routes/${result.id})`;
      } else if (name === 'get-athlete-clubs' && Array.isArray(result)) {
        stravaLinks = '\n\n---\n**View on Strava:**\n' +
          result.slice(0, 10).map((c: any) =>
            `• [${c.name || 'Club'}](https://www.strava.com/clubs/${c.id})`
          ).join('\n');
      } else if (name === 'get-club' && result?.id) {
        stravaLinks = `\n\n[View club on Strava](https://www.strava.com/clubs/${result.id})`;
      }

      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: resultText + stravaLinks
            }
          ]
        }
      };

    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Tool execution failed',
          data: { message: error.message, tool: name }
        }
      };
    }
  }
}

// MCP over SSE endpoint handler
// Supports the legacy HTTP+SSE transport used by Claude Desktop and other clients.
// For the newer Streamable HTTP transport, use POST /mcp directly.
export async function handleMCPOverSSE(c: Context) {
  const env = c.env as Env;
  const mcpServer = new SportMCPServer(env);

  return streamSSE(c, async (stream) => {
    let context: any = {
      baseUrl: (() => {
        try {
          return new URL(c.req.url).origin;
        } catch {
          return 'https://your-worker-name.your-subdomain.workers.dev';
        }
      })()
    };

    // --- Authentication: prefer Bearer header, then token query param, then cookie/device ---
    const authHeader = c.req.header('Authorization');
    const personalToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : c.req.query('token');
    let authenticatedAthleteId: number | null = null;

    if (personalToken) {
      try {
        const personalData = await env.STRAVA_SESSIONS.get(`personal_mcp:${personalToken}`);
        if (personalData) {
          const tokenInfo = JSON.parse(personalData);
          authenticatedAthleteId = tokenInfo.athlete_id;
        }
      } catch (_) {}
    }

    if (!authenticatedAthleteId) {
      // Fall back to AuthMiddleware (cookie / device fingerprint)
      try {
        const authMiddleware = new AuthMiddleware(env);
        const mockContext = {
          req: c.req,
          env: c.env,
          get: () => null,
          set: (key: string, value: any) => {
            if (key === 'session') context.session = value;
            if (key === 'token') context.token = value;
          }
        };
        await authMiddleware.authenticate(mockContext as any, async () => {});
        if (context.session) {
          authenticatedAthleteId = context.session.athlete_id;
        }
      } catch (_) {}
    }

    if (authenticatedAthleteId && !context.session) {
      try {
        const { KVSessionManager } = await import('./session');
        const sessionManager = new KVSessionManager(env);
        const session = await sessionManager.getSession(authenticatedAthleteId);
        if (session) {
          const now = Math.floor(Date.now() / 1000);
          if (session.expires_at <= now + 300) {
            const refreshed = await sessionManager.refreshToken(session);
            context.session = refreshed;
            context.token = refreshed.access_token;
          } else {
            context.session = session;
            context.token = session.access_token;
          }
        }
      } catch (_) {}
    }

    // Send server capabilities
    await stream.writeSSE({
      event: 'endpoint',
      data: `${context.baseUrl}/messages${personalToken ? `?token=${personalToken}` : ''}`
    });

    await stream.writeSSE({
      data: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })
    });

    // Handle incoming messages
    const handleMessage = async (data: string) => {
      try {
        const request = JSON.parse(data) as MCPRequest;
        const response = await mcpServer.handleMCPRequest(request, context);
        
        await stream.writeSSE({
          data: JSON.stringify(response)
        });
      } catch (error) {
        await stream.writeSSE({
          data: JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error',
              data: { message: 'Invalid JSON' }
            }
          })
        });
      }
    };

    // Keep connection alive
    const keepAlive = setInterval(async () => {
      await stream.writeSSE({
        data: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/ping',
          params: { timestamp: Date.now() }
        })
      });
    }, 30000);

    // Cleanup on close
    stream.onAbort = () => {
      clearInterval(keepAlive);
    };
  });
}
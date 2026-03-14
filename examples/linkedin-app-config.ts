/**
 * Example electron-dev-bridge config for the linkedin-app.
 *
 * All 38 IPC handlers are mapped as tools.  Where the auto-derived preload
 * path (channel "domain:action" -> window.electronAPI.domain.action) differs
 * from the actual preload method name, a `preloadPath` override is added.
 *
 * Schema imports are commented out because this file is a standalone example;
 * uncomment them when using inside the linkedin-app project.
 */

import { defineConfig } from 'electron-dev-bridge'

// Uncomment to wire up Zod schemas for input validation:
// import {
//   profileQuerySchema,
//   tagAddSchema,
//   tagBulkSchema,
//   crawlJobSchema,
//   autoTagRuleSchema,
// } from '../src/main/ipc-schemas'

export default defineConfig({
  app: {
    name: 'linkedin-app',
    path: '/Users/marchi-lau/Development/repos/delta-and-beta/linkedin-app',
    debugPort: 9229,
  },

  tools: {
    // -----------------------------------------------------------------------
    // Profiles (8 handlers)
    // -----------------------------------------------------------------------
    'profiles:query': {
      description: 'Search and filter saved LinkedIn profiles with pagination',
      // schema: profileQuerySchema,
      returns: 'Array of profile objects',
    },
    'profiles:get': {
      description: 'Get a single profile by ID, including experience, education, skills, languages, notes, and tags',
      returns: 'Profile object with nested relations, or undefined',
    },
    'profiles:delete': {
      description: 'Delete a saved profile by ID',
    },
    'profiles:deleteAll': {
      description: 'Delete all saved profiles from the database',
    },
    'profiles:stats': {
      description: 'Get aggregate profile statistics (total count, tag distribution, etc.)',
      preloadPath: 'window.electronAPI.profiles.getStats',
      returns: 'Statistics object',
    },
    'profiles:setRating': {
      description: 'Set a numeric rating on a profile',
    },
    'profiles:getDuplicates': {
      description: 'Get IDs of duplicate profiles detected in the database',
      returns: 'Array of profile ID strings',
    },
    'profiles:markViewed': {
      description: 'Mark a profile as viewed, updating its last_viewed_at timestamp',
    },

    // -----------------------------------------------------------------------
    // Tags (7 handlers)
    // -----------------------------------------------------------------------
    'tags:add': {
      description: 'Add a tag to a profile',
      // schema: tagAddSchema,
    },
    'tags:remove': {
      description: 'Remove a tag from a profile',
    },
    'tags:bulkAdd': {
      description: 'Add a tag to multiple profiles at once',
      // schema: tagBulkSchema,
    },
    'tags:getAll': {
      description: 'Get all tags with usage counts',
      returns: 'Array of tag objects',
    },
    'tags:getRules': {
      description: 'Get all auto-tag rules',
      returns: 'Array of auto-tag rule objects',
    },
    'tags:saveRule': {
      description: 'Create or update an auto-tag rule',
      // schema: autoTagRuleSchema,
    },
    'tags:deleteRule': {
      description: 'Delete an auto-tag rule by tag name',
    },

    // -----------------------------------------------------------------------
    // Notes (3 handlers)
    // -----------------------------------------------------------------------
    'notes:add': {
      description: 'Add a note to a profile',
    },
    'notes:get': {
      description: 'Get all notes for a profile',
      returns: 'Array of note objects',
    },
    'notes:delete': {
      description: 'Delete a note by ID',
    },

    // -----------------------------------------------------------------------
    // Saved Searches (3 handlers)
    // -----------------------------------------------------------------------
    'savedSearches:save': {
      description: 'Save a search query for later reuse',
    },
    'savedSearches:getAll': {
      description: 'Get all saved search queries',
      returns: 'Array of saved search objects',
    },
    'savedSearches:delete': {
      description: 'Delete a saved search by ID',
    },

    // -----------------------------------------------------------------------
    // Crawl (6 handlers)
    // -----------------------------------------------------------------------
    'crawl:start': {
      description: 'Start a new crawl job (search, URL list, or connections)',
      // schema: crawlJobSchema,
      preloadPath: 'window.electronAPI.crawl.startJob',
    },
    'crawl:pause': {
      description: 'Pause the currently running crawl job',
      preloadPath: 'window.electronAPI.crawl.pauseJob',
    },
    'crawl:resume': {
      description: 'Resume a paused crawl job',
      preloadPath: 'window.electronAPI.crawl.resumeJob',
    },
    'crawl:stop': {
      description: 'Stop and cancel the currently running crawl job',
      preloadPath: 'window.electronAPI.crawl.stopJob',
    },
    'crawl:getJobs': {
      description: 'Get all crawl jobs with their status',
      returns: 'Array of crawl job objects',
    },
    'crawl:getQueue': {
      description: 'Get queue statistics for a specific crawl job',
      returns: 'Queue stats object',
    },

    // -----------------------------------------------------------------------
    // Session (3 handlers)
    // -----------------------------------------------------------------------
    'session:getStatus': {
      description: 'Get current LinkedIn session status (logged in, cookies valid, etc.)',
      returns: 'Session status object',
    },
    'session:logout': {
      description: 'Clear the cached LinkedIn session',
    },
    'session:restore': {
      description: 'Attempt to restore a previously cached LinkedIn session',
    },

    // -----------------------------------------------------------------------
    // Settings (2 handlers)
    // -----------------------------------------------------------------------
    'settings:get': {
      description: 'Get all application settings as key-value pairs',
      returns: 'Object of setting key-value pairs',
    },
    'settings:set': {
      description: 'Set a single application setting by key',
    },

    // -----------------------------------------------------------------------
    // Sync (3 handlers)
    // -----------------------------------------------------------------------
    'sync:getStatus': {
      description: 'Get the current Turso sync replication status',
      returns: 'Sync status object',
    },
    'sync:trigger': {
      description: 'Trigger an immediate Turso sync replication',
    },
    'sync:configure': {
      description: 'Configure Turso sync replication settings',
    },

    // -----------------------------------------------------------------------
    // API Logs (3 handlers)
    // -----------------------------------------------------------------------
    'apiLogs:query': {
      description: 'Query captured LinkedIn API call logs with optional filters',
      returns: 'Array of API log entries',
    },
    'apiLogs:get': {
      description: 'Get a single API log entry by ID, including the full response body',
      returns: 'API log entry object',
    },
    'apiLogs:clear': {
      description: 'Clear all captured API log entries',
    },
  },

  resources: {
    'crawl:progress': {
      description: 'Live crawl progress (crawled count, total, percentage)',
      uri: 'electron://linkedin-app/crawl/progress',
      pollExpression: 'window.__crawlProgress || { crawled: 0, total: 0 }',
    },
    'session:status': {
      description: 'Current LinkedIn session status',
      uri: 'electron://linkedin-app/session/status',
      pollExpression: 'window.electronAPI.session.getStatus()',
    },
  },

  cdpTools: true,

  screenshots: {
    dir: './screenshots',
    format: 'png',
  },
})

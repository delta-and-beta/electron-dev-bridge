import { defineConfig } from 'electron-dev-bridge'

export default defineConfig({
  app: {
    name: 'test-app',
    path: __dirname,
  },

  tools: {
    'profiles:query': {
      description: 'Search profiles by name or email',
      returns: 'Array of profile objects with id, name, email, role',
    },
    'profiles:get': {
      description: 'Get a single profile by ID',
      returns: 'Profile object or null',
    },
    'settings:get': {
      description: 'Get current app settings',
      returns: 'Settings object with theme, language, notifications',
    },
    'settings:set': {
      description: 'Update app settings',
      returns: 'Updated settings object',
    },
    'tags:getAll': {
      description: 'Get all tags',
      returns: 'Array of tag strings',
    },
    'tags:add': {
      description: 'Add a new tag',
      returns: 'Updated array of tags',
    },
    'app:openSettings': {
      description: 'Open the settings window',
      returns: '{ opened: true }',
    },
  },

  cdpTools: true,
  screenshots: { dir: '.screenshots', format: 'png' },
})

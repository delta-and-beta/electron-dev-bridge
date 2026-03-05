import type { CdpTool, ToolContext } from './types.js'
import { toolResult } from './helpers.js'

export function createDomQueryTools(ctx: ToolContext): CdpTool[] {
  const { bridge } = ctx

  return [
    {
      definition: {
        name: 'electron_query_selector',
        description:
          'Find a single DOM element matching a CSS selector. Returns attributes and an HTML preview.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to match.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()

        const client = bridge.getRawClient()
        const { root } = await client.DOM.getDocument()
        const { nodeId } = await client.DOM.querySelector({
          nodeId: root.nodeId,
          selector,
        })

        if (nodeId === 0) {
          return toolResult({ found: false })
        }

        const { attributes: attrArray } = await client.DOM.getAttributes({ nodeId })
        const { outerHTML } = await client.DOM.getOuterHTML({ nodeId })

        const attributes: Record<string, string> = {}
        for (let i = 0; i < attrArray.length; i += 2) {
          attributes[attrArray[i]] = attrArray[i + 1]
        }

        return toolResult({
          found: true,
          nodeId,
          attributes,
          outerHTMLPreview: outerHTML.slice(0, 500),
        })
      },
    },
    {
      definition: {
        name: 'electron_query_selector_all',
        description:
          'Find all DOM elements matching a CSS selector. Returns up to 50 elements with HTML previews.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to match.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()

        const client = bridge.getRawClient()
        const { root } = await client.DOM.getDocument()
        const { nodeIds } = await client.DOM.querySelectorAll({
          nodeId: root.nodeId,
          selector,
        })

        const limited = nodeIds.slice(0, 50)
        const elements = await Promise.all(
          limited.map(async (nid: number) => {
            const { outerHTML } = await client.DOM.getOuterHTML({ nodeId: nid })
            return { nodeId: nid, outerHTMLPreview: outerHTML.slice(0, 500) }
          })
        )

        return toolResult({
          count: nodeIds.length,
          returned: limited.length,
          elements,
        })
      },
    },
    {
      definition: {
        name: 'electron_find_by_text',
        description:
          'Find DOM elements containing specific text content using XPath. Returns up to 50 matches.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content to search for (partial match).',
            },
            tag: {
              type: 'string',
              description:
                'HTML tag to restrict search to (e.g. "button", "span"). Defaults to "*" (any tag).',
            },
          },
          required: ['text'],
        },
      },
      handler: async ({ text, tag = '*' }: { text: string; tag?: string }) => {
        bridge.ensureConnected()

        const safeTag = tag.replace(/[^a-zA-Z0-9*]/g, '') || '*'
        const safeText = JSON.stringify(text)

        const result = await bridge.evaluate(`
          (() => {
            const results = [];
            const xpath = '//${safeTag}[contains(text(), ${safeText})]';
            const snapshot = document.evaluate(
              xpath, document.body, null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
            );
            const count = snapshot.snapshotLength;
            const limit = Math.min(count, 50);
            for (let i = 0; i < limit; i++) {
              const el = snapshot.snapshotItem(i);
              const rect = el.getBoundingClientRect();
              results.push({
                tag: el.tagName.toLowerCase(),
                textPreview: (el.textContent || '').trim().slice(0, 200),
                id: el.id || null,
                className: el.className || null,
                boundingBox: {
                  x: rect.x, y: rect.y,
                  width: rect.width, height: rect.height
                }
              });
            }
            return { count, elements: results };
          })()
        `)

        return toolResult(result)
      },
    },
    {
      definition: {
        name: 'electron_find_by_role',
        description:
          'Find DOM elements by ARIA role (explicit or implicit). Returns up to 50 matches.',
        inputSchema: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              description:
                'ARIA role to search for (e.g. "button", "link", "textbox", "heading").',
            },
          },
          required: ['role'],
        },
      },
      handler: async ({ role }: { role: string }) => {
        bridge.ensureConnected()

        const safeRole = JSON.stringify(role)

        const result = await bridge.evaluate(`
          (() => {
            const IMPLICIT_ROLES = {
              button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', 'summary'],
              link: ['a[href]', 'area[href]'],
              textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="tel"]', 'input[type="url"]', 'input[type="search"]', 'input[type="password"]', 'textarea'],
              checkbox: ['input[type="checkbox"]'],
              radio: ['input[type="radio"]'],
              combobox: ['select'],
              img: ['img[alt]'],
              heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
              list: ['ul', 'ol'],
              listitem: ['li'],
              navigation: ['nav'],
              main: ['main'],
              banner: ['header'],
              contentinfo: ['footer'],
              complementary: ['aside'],
              form: ['form'],
              table: ['table'],
              row: ['tr'],
              cell: ['td'],
              columnheader: ['th']
            };

            const role = ${safeRole};
            const selectors = ['[role="' + role + '"]'];
            const implicit = IMPLICIT_ROLES[role];
            if (implicit) {
              implicit.forEach(s => selectors.push(s));
            }

            const combined = selectors.join(', ');
            const all = document.querySelectorAll(combined);
            const count = all.length;
            const limit = Math.min(count, 50);
            const elements = [];

            for (let i = 0; i < limit; i++) {
              const el = all[i];
              const rect = el.getBoundingClientRect();
              elements.push({
                role: el.getAttribute('role') || role,
                text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 200),
                id: el.id || null,
                className: el.className || null,
                boundingBox: {
                  x: rect.x, y: rect.y,
                  width: rect.width, height: rect.height
                }
              });
            }

            return { count, elements };
          })()
        `)

        return toolResult(result)
      },
    },
    {
      definition: {
        name: 'electron_get_accessibility_tree',
        description:
          'Get a structured accessibility tree of the current page, including roles, names, and interactive states.',
        inputSchema: {
          type: 'object',
          properties: {
            maxDepth: {
              type: 'number',
              description:
                'Maximum depth to traverse the DOM tree. Defaults to 10.',
            },
          },
        },
      },
      handler: async ({ maxDepth = 10 }: { maxDepth?: number } = {}) => {
        bridge.ensureConnected()

        const tree = await bridge.evaluate(`
          (() => {
            const IMPLICIT_ROLES = {
              BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox',
              SELECT: 'combobox', IMG: 'img', H1: 'heading', H2: 'heading',
              H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
              UL: 'list', OL: 'list', LI: 'listitem', NAV: 'navigation',
              MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
              ASIDE: 'complementary', FORM: 'form', TABLE: 'table',
              TR: 'row', TD: 'cell', TH: 'columnheader', SUMMARY: 'button'
            };

            function walk(el, depth) {
              if (depth > ${maxDepth}) return null;
              if (!el || el.nodeType !== 1) return null;

              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return null;

              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;

              let name = el.getAttribute('aria-label')
                || el.getAttribute('alt')
                || el.getAttribute('title')
                || el.getAttribute('placeholder');

              if (!name && el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) name = label.textContent.trim();
              }

              if (!name) {
                let directText = '';
                for (const child of el.childNodes) {
                  if (child.nodeType === 3) directText += child.textContent;
                }
                directText = directText.trim();
                if (directText) name = directText.slice(0, 200);
              }

              const classes = el.className && typeof el.className === 'string'
                ? el.className.split(/\\\\s+/).slice(0, 5).join(' ')
                : null;

              const node = { tag };
              if (role) node.role = role;
              if (name) node.name = name;
              if (el.id) node.id = el.id;
              if (classes) node.class = classes;
              if (el.dataset && el.dataset.testid) node.dataTestId = el.dataset.testid;

              if (el.value !== undefined && el.value !== '') node.value = String(el.value).slice(0, 200);
              if (el.type) node.type = el.type;
              if (el.href) node.href = el.href;
              if (el.disabled) node.disabled = true;
              if (el.checked) node.checked = true;
              const expanded = el.getAttribute('aria-expanded');
              if (expanded !== null) node.ariaExpanded = expanded;
              const selected = el.getAttribute('aria-selected');
              if (selected !== null) node.ariaSelected = selected;
              const ariaDisabled = el.getAttribute('aria-disabled');
              if (ariaDisabled !== null) node.ariaDisabled = ariaDisabled;

              const children = [];
              for (const child of el.children) {
                const c = walk(child, depth + 1);
                if (c) children.push(c);
              }
              if (children.length > 0) node.children = children;

              return node;
            }

            return walk(document.body, 0);
          })()
        `)

        return toolResult(tree)
      },
    },
  ]
}

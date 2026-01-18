#!/usr/bin/env node
/**
 * Notion to NotebookLM Sync Tool
 * ------------------------------
 * Standalone CLI tool that connects to your Notion workspace,
 * lets you select a database interactively, and exports to markdown.
 *
 * Run as executable or with: node sync.js
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const Conf = require('conf');
const inquirer = require('inquirer');

// Output configuration
const OUTPUT_DIR = './output';

// ============================================
// CONFIG STORAGE (replaces .env requirement)
// ============================================

const config = new Conf({
  projectName: 'notion-notebooklm-sync',
  schema: {
    notionApiKey: {
      type: 'string',
      default: ''
    }
  }
});

function getStoredApiKey() {
  return config.get('notionApiKey');
}

function storeApiKey(apiKey) {
  config.set('notionApiKey', apiKey);
}

function clearApiKey() {
  config.delete('notionApiKey');
}

// ============================================
// INTERACTIVE PROMPTS
// ============================================

async function promptForApiKey(existingKey = null) {
  if (existingKey) {
    const maskedKey = existingKey.substring(0, 10) + '...' + existingKey.substring(existingKey.length - 4);
    const { useExisting } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useExisting',
        message: `Use saved API key (${maskedKey})?`,
        default: true
      }
    ]);

    if (useExisting) {
      return existingKey;
    }
  }

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Notion API key:',
      mask: '*',
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'API key is required';
        }
        if (!input.startsWith('secret_') && !input.startsWith('ntn_')) {
          return 'API key should start with "secret_" or "ntn_"';
        }
        return true;
      }
    }
  ]);

  // Save for future runs
  storeApiKey(apiKey);
  console.log('   API key saved for future runs.\n');

  return apiKey;
}

async function promptForDatabase(databases) {
  const choices = databases.map(db => ({
    name: `${db.title} ${db.description ? `(${db.description})` : ''}`,
    value: db.id,
    short: db.title
  }));

  const { databaseId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'databaseId',
      message: 'Select a database to sync:',
      choices: choices,
      pageSize: 15
    }
  ]);

  return databaseId;
}

async function promptForOutputFilename(defaultName) {
  console.log('   Enter a filename or press Enter to use the default.\n');
  const { filename } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filename',
      message: 'Save as:',
      default: defaultName,
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Filename is required';
        }
        // Check for invalid filename characters
        if (/[<>:"/\\|?*]/.test(input)) {
          return 'Filename contains invalid characters';
        }
        return true;
      }
    }
  ]);

  // Ensure .md extension
  return filename.endsWith('.md') ? filename : filename + '.md';
}

// ============================================
// NOTION API FUNCTIONS
// ============================================

/**
 * Fetches all databases the integration has access to
 */
async function fetchAllDatabases(notion) {
  const databases = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.search({
      filter: { property: 'object', value: 'database' },
      start_cursor: startCursor,
      page_size: 100
    });

    for (const db of response.results) {
      // Extract database title
      let title = 'Untitled Database';
      if (db.title && db.title.length > 0) {
        title = db.title.map(t => t.plain_text).join('');
      }

      // Extract description if available
      let description = '';
      if (db.description && db.description.length > 0) {
        description = db.description.map(t => t.plain_text).join('');
      }

      databases.push({
        id: db.id,
        title: title,
        description: description,
        url: db.url
      });
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return databases;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extracts plain text from Notion's rich text format
 */
function extractPlainText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) {
    return '';
  }
  return richTextArray.map(textItem => textItem.plain_text).join('');
}

/**
 * Converts rich text to markdown with formatting (bold, italic, code, links)
 */
function richTextToMarkdown(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) {
    return '';
  }

  return richTextArray.map(textItem => {
    let text = textItem.plain_text;

    // Apply formatting based on annotations
    if (textItem.annotations) {
      if (textItem.annotations.code) {
        text = `\`${text}\``;
      }
      if (textItem.annotations.bold) {
        text = `**${text}**`;
      }
      if (textItem.annotations.italic) {
        text = `*${text}*`;
      }
      if (textItem.annotations.strikethrough) {
        text = `~~${text}~~`;
      }
    }

    // Handle links
    if (textItem.href) {
      text = `[${text}](${textItem.href})`;
    }

    return text;
  }).join('');
}

/**
 * Extracts the value from a Notion property based on its type
 */
function extractPropertyValue(property) {
  switch (property.type) {
    case 'title':
      return extractPlainText(property.title);
    case 'rich_text':
      return extractPlainText(property.rich_text);
    case 'number':
      return property.number !== null ? property.number.toString() : '';
    case 'select':
      return property.select ? property.select.name : '';
    case 'multi_select':
      return property.multi_select.map(item => item.name).join(', ');
    case 'date':
      if (!property.date) return '';
      let dateStr = property.date.start;
      if (property.date.end) {
        dateStr += ` to ${property.date.end}`;
      }
      return dateStr;
    case 'checkbox':
      return property.checkbox ? 'Yes' : 'No';
    case 'url':
      return property.url || '';
    case 'email':
      return property.email || '';
    case 'phone_number':
      return property.phone_number || '';
    case 'status':
      return property.status ? property.status.name : '';
    case 'created_time':
      return property.created_time;
    case 'last_edited_time':
      return property.last_edited_time;
    default:
      return `[${property.type} property]`;
  }
}

// ============================================
// BLOCK CONVERSION FUNCTIONS
// ============================================

/**
 * Fetches all blocks (content) from a Notion page
 */
async function fetchPageBlocks(notion, pageId) {
  const blocks = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
      page_size: 100,
    });

    blocks.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return blocks;
}

/**
 * Converts a single Notion block to markdown
 */
function blockToMarkdown(block) {
  const type = block.type;

  switch (type) {
    case 'paragraph':
      return richTextToMarkdown(block.paragraph.rich_text);
    case 'heading_1':
      return `## ${richTextToMarkdown(block.heading_1.rich_text)}`;
    case 'heading_2':
      return `### ${richTextToMarkdown(block.heading_2.rich_text)}`;
    case 'heading_3':
      return `#### ${richTextToMarkdown(block.heading_3.rich_text)}`;
    case 'bulleted_list_item':
      return `- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}`;
    case 'numbered_list_item':
      return `1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}`;
    case 'to_do':
      const checked = block.to_do.checked ? 'x' : ' ';
      return `- [${checked}] ${richTextToMarkdown(block.to_do.rich_text)}`;
    case 'code':
      const language = block.code.language || '';
      const code = extractPlainText(block.code.rich_text);
      return `\`\`\`${language}\n${code}\n\`\`\``;
    case 'quote':
      return `> ${richTextToMarkdown(block.quote.rich_text)}`;
    case 'callout':
      const icon = block.callout.icon?.emoji || '';
      return `> ${icon} ${richTextToMarkdown(block.callout.rich_text)}`;
    case 'divider':
      return '---';
    case 'toggle':
      return `<details>\n<summary>${richTextToMarkdown(block.toggle.rich_text)}</summary>\n</details>`;
    case 'image':
      let imageUrl = '';
      if (block.image.type === 'external') {
        imageUrl = block.image.external.url;
      } else if (block.image.type === 'file') {
        imageUrl = block.image.file.url;
      }
      const caption = block.image.caption ? extractPlainText(block.image.caption) : 'Image';
      return `![${caption}](${imageUrl})`;
    case 'bookmark':
      return `[Bookmark: ${block.bookmark.url}](${block.bookmark.url})`;
    case 'link_preview':
      return `[Link: ${block.link_preview.url}](${block.link_preview.url})`;
    case 'embed':
      return `[Embedded content: ${block.embed.url}](${block.embed.url})`;
    case 'video':
      let videoUrl = '';
      if (block.video.type === 'external') {
        videoUrl = block.video.external.url;
      } else if (block.video.type === 'file') {
        videoUrl = block.video.file.url;
      }
      return `[Video: ${videoUrl}](${videoUrl})`;
    case 'table':
      return '[Table - content extracted below]';
    case 'table_row':
      const cells = block.table_row.cells.map(cell => extractPlainText(cell)).join(' | ');
      return `| ${cells} |`;
    case 'child_page':
      return `**[${block.child_page.title}]**`;
    case 'child_database':
      return `**[Database: ${block.child_database.title}]**`;
    case 'synced_block':
    case 'column_list':
    case 'column':
      return '';
    default:
      return `[${type} block]`;
  }
}

/**
 * Recursively fetches and converts all blocks including nested children
 */
async function fetchAndConvertBlocks(notion, blockId, depth = 0) {
  const blocks = await fetchPageBlocks(notion, blockId);
  const lines = [];
  const indent = '  '.repeat(depth);

  for (const block of blocks) {
    let markdown = blockToMarkdown(block);

    if (depth > 0 && markdown) {
      markdown = indent + markdown;
    }

    if (markdown) {
      lines.push(markdown);
    }

    if (block.has_children) {
      const childContent = await fetchAndConvertBlocks(notion, block.id, depth + 1);
      if (childContent) {
        lines.push(childContent);
      }
    }
  }

  return lines.join('\n');
}

// ============================================
// PAGE CONVERSION
// ============================================

/**
 * Converts a single Notion page to markdown format
 */
async function pageToMarkdown(notion, page, index, total) {
  const lines = [];

  // Find the title property
  let title = 'Untitled';
  for (const [propName, propValue] of Object.entries(page.properties)) {
    if (propValue.type === 'title') {
      title = extractPropertyValue(propValue) || 'Untitled';
      break;
    }
  }

  // Show progress
  process.stdout.write(`\r   Processing: ${index + 1}/${total} - ${title.substring(0, 40)}...`);

  lines.push(`# ${title}`);
  lines.push('');

  // Add properties section
  const properties = [];
  for (const [propName, propValue] of Object.entries(page.properties)) {
    if (propValue.type === 'title') continue;
    const value = extractPropertyValue(propValue);
    if (value) {
      properties.push(`**${propName}:** ${value}`);
    }
  }

  if (properties.length > 0) {
    lines.push(properties.join('  \n'));
    lines.push('');
  }

  // Fetch and add the full page content
  try {
    const pageContent = await fetchAndConvertBlocks(notion, page.id);
    if (pageContent.trim()) {
      lines.push(pageContent);
    }
  } catch (error) {
    lines.push(`*[Could not fetch page content: ${error.message}]*`);
  }

  lines.push('');
  lines.push(`*Source: [View in Notion](${page.url})*`);

  return lines.join('\n');
}

/**
 * Converts all pages to a single markdown document
 */
async function allPagesToMarkdown(notion, pages) {
  const sections = [];

  for (let i = 0; i < pages.length; i++) {
    const markdown = await pageToMarkdown(notion, pages[i], i, pages.length);
    sections.push(markdown);
  }

  console.log('\n');

  return sections.join('\n\n---\n\n');
}

/**
 * Saves content to a file
 */
function saveToFile(content, filename) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf8');

  return filePath;
}

/**
 * Converts a database title to a valid filename
 */
function titleToFilename(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) + '.md';
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('\nNotion to NotebookLM Sync Tool\n');
  console.log('='.repeat(50));

  try {
    // Step 1: Get API key (from storage or prompt)
    console.log('\n[1/5] Authentication\n');
    const storedKey = getStoredApiKey();
    const apiKey = await promptForApiKey(storedKey);

    // Initialize Notion client
    const notion = new Client({ auth: apiKey });

    // Step 2: Fetch all accessible databases
    console.log('\n[2/5] Fetching your databases...\n');
    let databases;
    try {
      databases = await fetchAllDatabases(notion);
    } catch (error) {
      if (error.code === 'unauthorized') {
        console.error('   Authentication failed! Your API key may be invalid.');
        console.error('   Clearing saved key. Please try again.\n');
        clearApiKey();
        process.exit(1);
      }
      throw error;
    }

    if (databases.length === 0) {
      console.error('   No databases found!');
      console.error('   Make sure you have shared at least one database with your integration.');
      console.error('   To share: Open database in Notion > ... menu > Connections > Add your integration\n');
      process.exit(1);
    }

    console.log(`   Found ${databases.length} database(s)\n`);

    // Step 3: Let user select a database
    console.log('[3/5] Database Selection\n');
    const selectedDbId = await promptForDatabase(databases);
    const selectedDb = databases.find(db => db.id === selectedDbId);

    // Step 4: Choose output filename
    console.log('\n[4/5] Output Filename\n');
    const defaultFilename = titleToFilename(selectedDb.title);
    const outputFilename = await promptForOutputFilename(defaultFilename);

    // Step 5: Sync the selected database
    console.log(`\n[5/5] Syncing "${selectedDb.title}"...\n`);

    // Fetch all pages from the database
    const allPages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: selectedDbId,
        start_cursor: startCursor,
        page_size: 100,
      });

      allPages.push(...response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    console.log(`   Found ${allPages.length} entries\n`);

    if (allPages.length === 0) {
      console.log('   No entries found in this database.\n');
      return;
    }

    // Convert to markdown
    console.log('   Fetching page content and converting to Markdown...');
    const markdownContent = await allPagesToMarkdown(notion, allPages);

    // Add header to the document
    const timestamp = new Date().toISOString().split('T')[0];
    const header = `# ${selectedDb.title}\n\nExported on: ${timestamp}\nTotal entries: ${allPages.length}\nSource: ${selectedDb.url}\n\n---\n\n`;
    const fullDocument = header + markdownContent;

    // Save to file
    console.log('   Saving to file...');
    const filePath = saveToFile(fullDocument, outputFilename);
    const absolutePath = path.resolve(filePath);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('\n SUCCESS! Your Notion database has been exported.\n');
    console.log('='.repeat(50));
    console.log(`\n   Database: ${selectedDb.title}`);
    console.log(`   Entries:  ${allPages.length}`);
    console.log(`   Size:     ${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`);
    console.log('\n   FILE CREATED:');
    console.log(`   ${absolutePath}`);
    console.log('\n' + '='.repeat(50));
    console.log('\n   Next steps:');
    console.log('      1. Open the file above to verify the content');
    console.log('      2. Upload to NotebookLM as a source');
    console.log('      3. Start asking questions about your Notion data!\n');

  } catch (error) {
    console.error('\nError occurred:\n');

    if (error.code === 'unauthorized') {
      console.error('   Authentication failed! Check your Notion API key.\n');
    } else if (error.code === 'object_not_found') {
      console.error('   Database not found!');
      console.error('   Make sure you have shared the database with your integration.\n');
    } else {
      console.error(`   ${error.message}\n`);
    }

    process.exit(1);
  }
}

// Run the main function
main();

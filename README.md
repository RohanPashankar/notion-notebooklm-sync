# Notion to NotebookLM Sync

A standalone CLI tool that exports your Notion databases to markdown files, ready for upload to Google's NotebookLM.

## Features

- **No Node.js required** - Download and run the standalone executable
- **Interactive CLI** - Select databases from a list, no config files needed
- **Secure API key storage** - Your key is saved locally for future runs
- **Full page content** - Exports properties AND page content (text, headings, lists, code blocks, etc.)
- **Cross-platform** - Builds available for Windows, macOS, and Linux

## Quick Start

### Option 1: Download Executable (Recommended)

1. Download the latest release for your platform from [Releases](https://github.com/RohanPashankar/notion-notebooklm-sync/releases)
2. Run the executable
3. Enter your Notion API key when prompted
4. Select a database to export
5. Upload the generated `.md` file to NotebookLM

### Option 2: Run with Node.js

```bash
git clone https://github.com/RohanPashankar/notion-notebooklm-sync.git
cd notion-notebooklm-sync
npm install
node sync.js
```

## Setup: Get Your Notion API Key

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Give it a name (e.g., "NotebookLM Sync")
4. Copy the **Internal Integration Secret** (starts with `secret_` or `ntn_`)

### Share Databases with Your Integration

For each database you want to export:

1. Open the database in Notion
2. Click **...** (menu) in the top right
3. Go to **Connections** → **Add connections**
4. Select your integration

## Usage

```
Notion to NotebookLM Sync Tool

==================================================

[1/5] Authentication

? Use saved API key (secret_abc...xyz)? (Y/n)

[2/5] Fetching your databases...

   Found 3 database(s)

[3/5] Database Selection

? Select a database to sync:
> My Reading List
  Project Notes
  Recipe Collection

[4/5] Output Filename

   Enter a filename or press Enter to use the default.

? Save as: (my-reading-list.md)

[5/5] Syncing "My Reading List"...

   Found 42 entries

==================================================

 SUCCESS! Your Notion database has been exported.

==================================================

   FILE CREATED:
   C:\Users\You\output\my-reading-list.md
```

## Build from Source

```bash
# Install dependencies
npm install

# Build for your platform
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
npm run build:all     # All platforms

# Executables are created in ./dist/
```

## Output Format

The tool generates a markdown file with:

- Document header with export date and entry count
- Each database entry as a section with:
  - Title as heading
  - All properties (status, tags, dates, etc.)
  - Full page content (paragraphs, lists, code blocks, images, etc.)
  - Link back to the original Notion page

## Supported Notion Block Types

- Paragraphs, headings (H1-H3)
- Bulleted, numbered, and to-do lists
- Code blocks (with syntax highlighting preserved)
- Quotes and callouts
- Images and bookmarks
- Tables
- Toggle blocks
- Embedded content

## License

MIT

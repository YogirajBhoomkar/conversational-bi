# Conversational BI: Documentation

This folder explains the Conversational BI code in plain English. You do not need to know the technology to follow it.

## What is this app?

You type a business question in a chat box, for example *"Chart FOT premium by region"*.
The app finds the numbers in Databricks, draws a chart, shows a table, shows the SQL that was used, and writes a short answer. It also suggests what to ask next.

The "brain" that decides what to do is called the **supervisor agent**. It is written with a tool called **Mastra**. This documentation is mostly about that supervisor and everything around it.

## Reading order

Read them in this order. Each one builds on the one before.

| # | File | Read it to learn... | Time |
|---|------|---------------------|------|
| 1 | [01-big-picture.md](01-big-picture.md) | What the app does, who the "players" are, and one question followed end to end | 10 min |
| 2 | [02-server-files.md](02-server-files.md) | Every server file: what it does, what goes in, what comes out | 25 min |
| 3 | [03-ui-files.md](03-ui-files.md) | Every screen file in the browser app | 10 min |
| 4 | [04-data-flows-and-contracts.md](04-data-flows-and-contracts.md) | Diagrams of each flow (login, chat, charts, full results) and the exact shape of the data passed around | 15 min |
| 5 | [05-settings-limits-and-cookbook.md](05-settings-limits-and-cookbook.md) | Settings, how to run it, how to change things, and known problems | 10 min |

If you only have five minutes, read the **"One question, start to finish"** section in file 1.

## Quick facts

| Thing | Value |
|-------|-------|
| Server | Node.js + TypeScript, built on Mastra (folder `server/`) |
| Browser app | React + Vite (folder `ui/`) |
| Where the data lives | Databricks, reached through "Genie" |
| The AI model (LLM) | Claude by default, or any OpenAI-compatible model through a proxy |
| Address when started with `npm start` | http://localhost:1976 |
| Address in developer mode | server http://localhost:4111, browser app http://localhost:5173 |
| Genie mode | Set by `GENIE_MODE`. `agent` = new streaming mode. Empty = older chat mode |

## How the diagrams are drawn

The diagrams are written in a text format called **Mermaid**. They show up as pictures on GitHub and in most Markdown viewers.
In VS Code, install the extension **Markdown Preview Mermaid Support**, then open the Markdown preview.

## Other documents in the repo

* `README.md` in the main folder: setup and run instructions. Some details there are out of date. For example, it says Node 20 is enough, but Mastra needs Node 22.13 or newer. File 5 lists the differences.
* `docs/code-guide.html`: an older walkthrough written before several changes (Agent mode, streaming thinking, follow-up suggestions, full-result loading). Use these Markdown files instead.

## A warning before you share this code

The file `server/.env` holds secrets (tokens, API keys). **Never send it to anyone and never commit it.** Send `server/.env.example` instead.

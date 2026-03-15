import * as vscode from "vscode"

import { type ModeConfig, type PromptComponent, type CustomModePrompts, type TodoItem } from "@roo-code/types"

import { Mode, modes, defaultModeSlug, getModeBySlug, getGroupName, getModeSelection } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { formatLanguage } from "../../shared/language"
import { isEmpty } from "../../utils/object"

import { McpHub } from "../../services/mcp/McpHub"
import { CodeIndexManager } from "../../services/code-index/manager"
import type { SkillsManager } from "../../services/skills/SkillsManager"

import type { SystemPromptSettings } from "./types"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
	markdownFormattingSection,
} from "./sections"

// Helper function to get prompt component, filtering out empty objects
export function getPromptComponent(
	customModePrompts: CustomModePrompts | undefined,
	mode: string,
): PromptComponent | undefined {
	const component = customModePrompts?.[mode]

	// Return undefined if component is empty
	if (isEmpty(component)) {
		return undefined
	}

	return component
}

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	experiments?: Record<string, boolean>,
	language?: string,
	rooIgnoreInstructions?: string,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// Intentionally retained for API compatibility with existing callers.
	void supportsComputerUse
	void diffStrategy
	void experiments
	void todoList
	void modelId
	void skillsManager

	// Get the full mode config to ensure we have the role definition (used for groups, etc.)
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const { roleDefinition, baseInstructions } = getModeSelection(mode, promptComponent, customModeConfigs)

	// Check if MCP functionality should be included
	const hasMcpGroup = modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	const hasMcpServers = !!mcpHub && mcpHub.getServers().length > 0
	const shouldIncludeMcp = hasMcpGroup && hasMcpServers

	// Ensure code index manager is initialized for the workspace.
	CodeIndexManager.getInstance(context, cwd)

	// Static across the workflow unless mode configuration changes globally.
	const modesSection = await getModesSection(context)

	// Keep the most dynamic/user-specific content as late as possible for KV cache reuse.
	const customInstructions = await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
		language: language ?? formatLanguage(vscode.env.language),
		rooIgnoreInstructions,
		settings,
	})

	const staticCoreSection = `====
SYSTEM CORE

${markdownFormattingSection()}

${getSharedToolUseSection()}

${getToolUseGuidelinesSection()}

${modesSection}

${getObjectiveSection()}

====

SKILLS

The skills catalog is at ~/.roo/skills/catalog.md — use read_file or list_files to discover and load skills as needed. Do not wait for skills to be injected.`

	const sessionContextSection = `====
SESSION CONTEXT

${getCapabilitiesSection(cwd, shouldIncludeMcp ? mcpHub : undefined)}

${getRulesSection(cwd, settings)}

${getSystemInfoSection(cwd)}`

	const roleDefinitionSection = `====
ROLE DEFINITION

${roleDefinition}`

	const customInstructionsSection = `====
CUSTOM INSTRUCTIONS

${customInstructions}`

	return `${staticCoreSection}

${sessionContextSection}

${roleDefinitionSection}

${customInstructionsSection}`
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	mode: Mode = defaultModeSlug,
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	experiments?: Record<string, boolean>,
	language?: string,
	rooIgnoreInstructions?: string,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts, mode)

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		diffStrategy,
		promptComponent,
		customModes,
		globalCustomInstructions,
		experiments,
		language,
		rooIgnoreInstructions,
		settings,
		todoList,
		modelId,
		skillsManager,
	)
}

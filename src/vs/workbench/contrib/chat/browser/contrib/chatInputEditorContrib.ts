/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IDecorationOptions } from 'vs/editor/common/editorCommon';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionList } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { editorForeground, textCodeBlockBackground, textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IChatWidget, IChatWidgetService } from 'vs/workbench/contrib/chat/browser/chat';
import { ChatWidget } from 'vs/workbench/contrib/chat/browser/chatWidget';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ChatInputPart } from 'vs/workbench/contrib/chat/browser/chatInputPart';
import { IChatService } from 'vs/workbench/contrib/chat/common/chatService';
import { ContentWidgetPositionPreference, IContentWidget } from 'vs/editor/browser/editorBrowser';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Selection } from 'vs/editor/common/core/selection';

const decorationDescription = 'chat';
const slashCommandPlaceholderDecorationType = 'chat-session-detail';
const slashCommandTextDecorationType = 'chat-session-text';
const slashCommandContentWidgetId = 'chat-session-content-widget';

class InputEditorDecorations extends Disposable {

	private _slashCommandDomNode = document.createElement('div');
	private _slashCommandContentWidget: IContentWidget | undefined;
	private _previouslyUsedSlashCommands = new Set<string>();

	constructor(
		private readonly widget: IChatWidget,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@IChatService private readonly chatService: IChatService,
	) {
		super();

		this.codeEditorService.registerDecorationType(decorationDescription, slashCommandPlaceholderDecorationType, {});

		this._register(this.themeService.onDidColorThemeChange(() => this.updateRegisteredDecorationTypes()));
		this.updateRegisteredDecorationTypes();

		this.updateInputEditorDecorations();
		this._register(this.widget.inputEditor.onDidChangeModelContent(() => this.updateInputEditorDecorations()));
		this._register(this.widget.onDidChangeViewModel(() => {
			this._previouslyUsedSlashCommands.clear();
			this.updateInputEditorDecorations();
		}));
		this._register(this.chatService.onDidSubmitSlashCommand((e) => {
			if (e.sessionId === this.widget.viewModel?.sessionId && !this._previouslyUsedSlashCommands.has(e.slashCommand)) {
				this._previouslyUsedSlashCommands.add(e.slashCommand);
			}
		}));
	}

	private updateRegisteredDecorationTypes() {
		this.codeEditorService.removeDecorationType(slashCommandTextDecorationType);
		this.updateInputEditorContentWidgets({ hide: true });
		this.codeEditorService.registerDecorationType(decorationDescription, slashCommandTextDecorationType, {
			opacity: '0',
			after: {
				contentText: ' ',
			}
		});
		this.updateInputEditorDecorations();
	}

	private getPlaceholderColor(): string | undefined {
		const theme = this.themeService.getColorTheme();
		const transparentForeground = theme.getColor(editorForeground)?.transparent(0.4);
		return transparentForeground?.toString();
	}

	private async updateInputEditorDecorations() {
		const inputValue = this.widget.inputEditor.getValue();
		const slashCommands = await this.widget.getSlashCommands(); // TODO this async call can lead to a flicker of the placeholder text when switching editor tabs

		if (!inputValue) {
			const extensionPlaceholder = this.widget.viewModel?.inputPlaceholder;
			const defaultPlaceholder = slashCommands?.length ?
				localize('interactive.input.placeholderWithCommands', "Ask a question or type '/' for topics") :
				localize('interactive.input.placeholderNoCommands', "Ask a question");
			const placeholder = extensionPlaceholder ?? defaultPlaceholder;
			const decoration: IDecorationOptions[] = [
				{
					range: {
						startLineNumber: 1,
						endLineNumber: 1,
						startColumn: 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: placeholder,
							color: this.getPlaceholderColor()
						}
					}
				}
			];
			this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandPlaceholderDecorationType, decoration);
			this.updateInputEditorContentWidgets({ hide: true });
			return;
		}

		let slashCommandPlaceholderDecoration: IDecorationOptions[] | undefined;
		const command = inputValue && slashCommands?.find(c => inputValue.startsWith(`/${c.command} `));
		if (command && inputValue === `/${command.command} `) {
			const isFollowupSlashCommand = this._previouslyUsedSlashCommands.has(command.command);
			const shouldRenderFollowupPlaceholder = command.followupPlaceholder && isFollowupSlashCommand;
			if (shouldRenderFollowupPlaceholder || command.detail) {
				slashCommandPlaceholderDecoration = [{
					range: {
						startLineNumber: 1,
						endLineNumber: 1,
						startColumn: command && typeof command !== 'string' ? (command?.command.length + 2) : 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: shouldRenderFollowupPlaceholder ? command.followupPlaceholder : command.detail,
							color: this.getPlaceholderColor(),
							padding: '0 0 0 5px'
						}
					}
				}];
				this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandPlaceholderDecorationType, slashCommandPlaceholderDecoration);
			}
		}
		if (!slashCommandPlaceholderDecoration) {
			this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandPlaceholderDecorationType, []);
		}

		if (command && inputValue.startsWith(`/${command.command} `)) {
			this.updateInputEditorContentWidgets({ command: command.command });
		} else {
			this.updateInputEditorContentWidgets({ hide: true });
		}

		if (command && command.detail) {
			const textDecoration: IDecorationOptions[] = [
				{
					range: {
						startLineNumber: 1,
						endLineNumber: 1,
						startColumn: 1,
						endColumn: command.command.length + 2
					}
				}
			];
			this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandTextDecorationType, textDecoration);
		} else {
			this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandTextDecorationType, []);
		}
	}

	private async updateInputEditorContentWidgets(arg: { command: string } | { hide: true }) {
		const domNode = this._slashCommandDomNode;

		if (this._slashCommandContentWidget && 'hide' in arg) {
			domNode.toggleAttribute('hidden', true);
			this.widget.inputEditor.removeContentWidget(this._slashCommandContentWidget);
			return;
		} else if ('command' in arg) {
			const theme = this.themeService.getColorTheme();
			domNode.style.padding = '0 0.4em';
			domNode.style.borderRadius = '3px';
			domNode.style.backgroundColor = theme.getColor(textCodeBlockBackground)?.toString() ?? '';
			domNode.style.color = theme.getColor(textLinkForeground)?.toString() ?? '';
			domNode.innerText = `${arg.command} `;
			domNode.toggleAttribute('hidden', false);

			this._slashCommandContentWidget = {
				getId() { return slashCommandContentWidgetId; },
				getDomNode() { return domNode; },
				getPosition() {
					return {
						position: {
							lineNumber: 1,
							column: 1
						},
						preference: [ContentWidgetPositionPreference.EXACT]
					};
				},
			};

			this.widget.inputEditor.addContentWidget(this._slashCommandContentWidget);
		}
	}
}

class InputEditorSlashCommandFollowups extends Disposable {
	constructor(
		private readonly widget: IChatWidget,
		@IChatService private readonly chatService: IChatService
	) {
		super();
		this._register(this.chatService.onDidSubmitSlashCommand(({ slashCommand, sessionId }) => this.repopulateSlashCommand(slashCommand, sessionId)));
		this._register(this.widget.inputEditor.onKeyUp((e) => this.handleKeyUp(e)));
	}

	private async repopulateSlashCommand(slashCommand: string, sessionId: string) {
		if (this.widget.viewModel?.sessionId !== sessionId) {
			return;
		}

		const slashCommands = await this.widget.getSlashCommands();

		if (this.widget.inputEditor.getValue().trim().length !== 0) {
			return;
		}

		if (slashCommands?.find(c => c.command === slashCommand)?.shouldRepopulate) {
			const value = `/${slashCommand} `;
			this.widget.inputEditor.setValue(value);
			this.widget.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });

		}
	}

	private handleKeyUp(e: IKeyboardEvent) {
		if (e.keyCode !== KeyCode.Backspace) {
			return;
		}

		const value = this.widget.inputEditor.getValue().split(' ')[0];
		const currentSelection = this.widget.inputEditor.getSelection();
		if (!value.startsWith('/') || !currentSelection?.isEmpty() || currentSelection?.startLineNumber !== 1 || currentSelection?.startColumn !== value.length + 1) {
			return;
		}

		if (this.widget.getSlashCommandsSync()?.find((command) => `/${command.command}` === value)) {
			this.widget.inputEditor.executeEdits('chat-input-editor-slash-commands', [{ range: new Range(1, 1, 1, currentSelection.startColumn), text: null }], [new Selection(1, 1, 1, 1)]);
		}
	}
}

ChatWidget.CONTRIBS.push(InputEditorDecorations, InputEditorSlashCommandFollowups);

class SlashCommandCompletions extends Disposable {
	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatSlashCommand',
			triggerCharacters: ['/'],
			provideCompletionItems: async (model: ITextModel, _position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget) {
					return null;
				}

				if (model.getValueInRange(new Range(1, 1, 1, 2)) !== '/' && model.getValueLength() > 0) {
					return null;
				}

				const slashCommands = await widget.getSlashCommands();
				if (!slashCommands) {
					return null;
				}

				return <CompletionList>{
					suggestions: slashCommands.map(c => {
						const withSlash = `/${c.command}`;
						return <CompletionItem>{
							label: withSlash,
							insertText: `${withSlash} `,
							detail: c.detail,
							range: new Range(1, 1, 1, 1),
							sortText: c.sortText ?? c.command,
							kind: CompletionItemKind.Text // The icons are disabled here anyway
						};
					})
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SlashCommandCompletions, LifecyclePhase.Eventually);

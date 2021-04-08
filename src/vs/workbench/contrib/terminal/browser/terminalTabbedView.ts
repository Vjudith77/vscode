/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Orientation, Sizing, SplitView } from 'vs/base/browser/ui/splitview/splitview';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalFindWidget } from 'vs/workbench/contrib/terminal/browser/terminalFindWidget';
import { TerminalTabsWidget } from 'vs/workbench/contrib/terminal/browser/terminalTabsWidget';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import * as dom from 'vs/base/browser/dom';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { DataTransfers } from 'vs/base/browser/dnd';
import { URI } from 'vs/base/common/uri';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IAction } from 'vs/base/common/actions';
import { IMenu, IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
const FIND_FOCUS_CLASS = 'find-focused';

export class TerminalTabbedView extends Disposable {

	private _splitView: SplitView;

	private _terminalContainer: HTMLElement;
	private _terminalTabTree: HTMLElement;
	private _parentElement: HTMLElement;

	private _tabsWidget: TerminalTabsWidget | undefined;
	private _findWidget: TerminalFindWidget;

	private _tabTreeIndex: number;
	private _terminalContainerIndex: number;

	private _showTabs: boolean;

	private _height: number | undefined;

	private _instantiationService: IInstantiationService;
	private _terminalService: ITerminalService;
	private _themeService: IThemeService;
	private _contextMenuService: IContextMenuService;

	private _cancelContextMenu: boolean = false;
	private _menu: IMenu;

	constructor(
		parentElement: HTMLElement,
		@ITerminalService terminalService: ITerminalService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IContextKeyService _contextKeyService: IContextKeyService,
		@IContextKeyService contextMenuService: IContextMenuService,
		@IMenuService _menuService: IMenuService
	) {
		super();

		this._instantiationService = instantiationService;
		this._terminalService = terminalService;
		this._themeService = themeService;
		this._contextMenuService = contextMenuService;

		this._parentElement = parentElement;

		this._terminalTabTree = document.createElement('div');
		this._terminalTabTree.classList.add('tabs-widget');

		this._tabsWidget = this._instantiationService.createInstance(TerminalTabsWidget, this._terminalTabTree);
		this._findWidget = this._instantiationService.createInstance(TerminalFindWidget, this._terminalService.getFindState());
		parentElement.appendChild(this._findWidget.getDomNode());

		this._terminalContainer = document.createElement('div');
		this._terminalContainer.classList.add('terminal-outer-container');
		this._terminalContainer.style.display = 'block';

		this._showTabs = terminalService.configHelper.config.showTabs;

		this._tabTreeIndex = terminalService.configHelper.config.tabsLocation === 'left' ? 0 : 1;
		this._terminalContainerIndex = terminalService.configHelper.config.tabsLocation === 'left' ? 1 : 0;

		this._menu = this._register(_menuService.createMenu(MenuId.TerminalContext, _contextKeyService));

		terminalService.setContainers(parentElement, this._terminalContainer);

		configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('terminal.integrated.showTabs')) {
				this._showTabs = terminalService.configHelper.config.showTabs;
				if (this._showTabs) {
					this._splitView.addView({
						element: this._terminalTabTree,
						layout: width => this._tabsWidget!.layout(this._height, width),
						minimumSize: 40,
						maximumSize: Number.POSITIVE_INFINITY,
						onDidChange: () => Disposable.None,
					}, Sizing.Distribute, this._tabTreeIndex);
				} else {
					this._splitView.removeView(this._tabTreeIndex);
				}
			} else if (e.affectsConfiguration('terminal.integrated.tabsLocation')) {
				this._tabTreeIndex = terminalService.configHelper.config.tabsLocation === 'left' ? 0 : 1;
				this._terminalContainerIndex = terminalService.configHelper.config.tabsLocation === 'left' ? 1 : 0;
				if (this._showTabs) {
					this._splitView.swapViews(0, 1);
				}
			}
		});

		this._register(themeService.onDidColorThemeChange(theme => this._updateTheme(theme)));
		this._updateTheme();

		this._findWidget.focusTracker.onDidFocus(() => this._terminalContainer!.classList.add(FIND_FOCUS_CLASS));

		this._attachEventListeners(parentElement, this._terminalContainer);

		this._splitView = new SplitView(parentElement, { orientation: Orientation.HORIZONTAL });

		this._setupSplitView();
	}

	private _setupSplitView(): void {
		this._register(this._splitView.onDidSashReset(() => this._splitView.distributeViewSizes()));

		if (this._showTabs) {
			this._splitView.addView({
				element: this._terminalTabTree,
				layout: width => this._tabsWidget!.layout(this._height, width),
				minimumSize: 40,
				maximumSize: Number.POSITIVE_INFINITY,
				onDidChange: () => Disposable.None,
			}, Sizing.Distribute, this._tabTreeIndex);
		}
		this._splitView.addView({
			element: this._terminalContainer,
			layout: width => this._terminalService.terminalTabs.forEach(tab => tab.layout(width, this._height || 0)),
			minimumSize: 120,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: () => Disposable.None
		}, Sizing.Distribute, this._terminalContainerIndex);

	}

	layout(width: number, height: number): void {
		this._splitView.layout(width);
		this._height = height;
	}

	private _updateTheme(theme?: IColorTheme): void {
		if (!theme) {
			theme = this._themeService.getColorTheme();
		}

		this._findWidget?.updateTheme(theme);
	}

	private _attachEventListeners(parentDomElement: HTMLElement, terminalContainer: HTMLElement): void {
		this._register(dom.addDisposableListener(parentDomElement, 'mousedown', async (event: MouseEvent) => {
			if (this._terminalService.terminalInstances.length === 0) {
				return;
			}

			if (event.which === 2 && isLinux) {
				// Drop selection and focus terminal on Linux to enable middle button paste when click
				// occurs on the selection itself.
				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					terminal.focus();
				}
			} else if (event.which === 3) {
				const rightClickBehavior = this._terminalService.configHelper.config.rightClickBehavior;
				if (rightClickBehavior === 'copyPaste' || rightClickBehavior === 'paste') {
					const terminal = this._terminalService.getActiveInstance();
					if (!terminal) {
						return;
					}

					// copyPaste: Shift+right click should open context menu
					if (rightClickBehavior === 'copyPaste' && event.shiftKey) {
						this._openContextMenu(event);
						return;
					}

					if (rightClickBehavior === 'copyPaste' && terminal.hasSelection()) {
						await terminal.copySelection();
						terminal.clearSelection();
					} else {
						if (BrowserFeatures.clipboard.readText) {
							terminal.paste();
						} else {
							this._notificationService.info(`This browser doesn't support the clipboard.readText API needed to trigger a paste, try ${isMacintosh ? '⌘' : 'Ctrl'}+V instead.`);
						}
					}
					// Clear selection after all click event bubbling is finished on Mac to prevent
					// right-click selecting a word which is seemed cannot be disabled. There is a
					// flicker when pasting but this appears to give the best experience if the
					// setting is enabled.
					if (isMacintosh) {
						setTimeout(() => {
							terminal.clearSelection();
						}, 0);
					}
					this._cancelContextMenu = true;
				}
			}
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'contextmenu', (event: MouseEvent) => {
			if (!this._cancelContextMenu) {
				this._openContextMenu(event);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(document, 'keydown', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(document, 'keyup', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'keyup', (event: KeyboardEvent) => {
			if (event.keyCode === 27) {
				// Keep terminal open on escape
				event.stopPropagation();
			}
		}));
		this._register(dom.addDisposableListener(parentDomElement, dom.EventType.DROP, async (e: DragEvent) => {
			if (e.target === this._parentElement || dom.isAncestor(e.target as HTMLElement, parentDomElement)) {
				if (!e.dataTransfer) {
					return;
				}

				// Check if files were dragged from the tree explorer
				let path: string | undefined;
				const resources = e.dataTransfer.getData(DataTransfers.RESOURCES);
				if (resources) {
					path = URI.parse(JSON.parse(resources)[0]).fsPath;
				} else if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].path /* Electron only */) {
					// Check if the file was dragged from the filesystem
					path = URI.file(e.dataTransfer.files[0].path).fsPath;
				}

				if (!path) {
					return;
				}

				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					const preparedPath = await this._terminalService.preparePathForTerminalAsync(path, terminal.shellLaunchConfig.executable, terminal.title, terminal.shellType);
					terminal.sendText(preparedPath, false);
					terminal.focus();
				}
			}
		}));
	}
	private _openContextMenu(event: MouseEvent): void {
		const standardEvent = new StandardMouseEvent(event);
		const anchor: { x: number, y: number } = { x: standardEvent.posx, y: standardEvent.posy };

		const actions: IAction[] = [];
		const actionsDisposable = createAndFillInContextMenuActions(this._menu, undefined, actions);

		this._contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => this._parentElement,
			onHide: () => actionsDisposable.dispose()
		});
	}
}

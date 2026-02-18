/* eslint-disable @typescript-eslint/no-explicit-any */
import { LitElement, html, TemplateResult, css, PropertyValues, CSSResultGroup } from 'lit';
import { customElement, property, state, query } from 'lit/decorators';
import { guard } from "lit/directives/guard.js";
import { mdiDrag, mdiNotificationClearAll, mdiPlus, mdiSort, mdiRefresh } from "@mdi/js";
import {
  HomeAssistant,
  hasConfigOrEntityChanged,
  LovelaceCardEditor,
  getLovelace,
} from 'custom-card-helpers';
import {
  addItem,
  clearItems,
  fetchItems,
  reorderItems,
  ShoppingListItem,
  editItem,
  markItem,
} from "./shopping-list";
import {
  loadSortable,
  SortableInstance,
} from "./sortable.ondemand";
import type { CoziCardConfig } from './types';
import {
  CARD_VERSION,
  CARD_TYPE,
  CARD_NAME,
  CARD_DESC,
} from './const';
import { localize } from './localize/localize';
import { HassEntity } from 'home-assistant-js-websocket';

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: CARD_TYPE,
  name: CARD_NAME,
  description: CARD_DESC,
});

@customElement('cozi-card')
export class CoziCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private config!: CoziCardConfig;
  @state() private _allItems?: ShoppingListItem[];
  @state() private _checkedItems?: ShoppingListItem[];
  @state() private _reordering = false;
  @state() private _renderEmptySortable = false;
  @state() private _currentList!: any; // Current selected list
  @state() private _lists!: any[]; // All lists from sensor
  @state() private _addValue = ''; // Input for new item
  @state() private _editId = ''; // ID of item being edited
  @state() private _editValue = ''; // Value for editing
  @state() private _newListTitle = ''; // For new list
  @state() private _newListType = 'shopping'; // Default type
  private _sortable?: SortableInstance;
  @query("#sortable") private _sortableEl?: HTMLElement;
  firstrun: boolean;

  constructor() {
    super();
    this._allItems = [];
    this._checkedItems = [];
    this.firstrun = true;
    this._lists = [];
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('cozi-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return {};
  }

  public setConfig(config: CoziCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }
    this.config = {
      ...config,
    };
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }
    return hasConfigOrEntityChanged(this, changedProps, true);
  }

  protected updated(changedProps: PropertyValues): void {
    if (changedProps.has('hass') || changedProps.has('_currentList')) {
      this._loadLists();
      this._fetchData();
    }
    if (changedProps.has('_reordering') && this._reordering) {
      this._createSortable();
    }
  }

  private _loadLists() {
    const sensor = this.hass.states['sensor.cozi_lists'] as HassEntity;
    if (sensor) {
      this._lists = sensor.attributes.lists || [];
      if (this._lists.length > 0 && !this._currentList) {
        this._currentList = this._lists[0]; // Default to first list
      }
    }
  }

  private async _fetchData(): Promise<void> {
    if (!this.hass || !this._currentList) {
      return;
    }
    const allItems: ShoppingListItem[] = [];
    const checkedItems: ShoppingListItem[] = [];
    const items = fetchItems(this._currentList.items); // Use current list items
    for (const key in items) {
      allItems.push(items[key]);
      if (items[key].status) {
        checkedItems.push(items[key]);
      }
    }
    this._allItems = allItems;
    this._checkedItems = checkedItems;
  }

  private _handleSelect(ev: Event) {
    const target = ev.target as HTMLSelectElement;
    if (target && target.value) {
      const index = parseInt(target.value, 10);
      this._currentList = this._lists[index];
    }
  }

  private async _handleAdd(ev: any, itemPos = 0): Promise<void> {
    const input = ev.target.nextElementSibling || ev.target;
    let index = itemPos;
    if (index > 0) {
      index += 1;
    }
    if (input.value.length > 0 && this._currentList) {
      await addItem(this.hass!,
        this._currentList.listId,
        input.value,
        index,
      );
      input.value = "";
      await this._fetchData();
    }
    input.focus();
  }

  private _handleEdit(id: string, text: string) {
    this._editId = id;
    this._editValue = text;
  }

  private async _saveEdit(id: string) {
    if (this._editValue && this._currentList) {
      await editItem(this.hass!,
        this._currentList.listId,
        id,
        this._editValue,
      );
      this._editId = '';
      await this._fetchData();
      this.requestUpdate();
    }
  }

  private async _handleMark(id: string, status: boolean) {
    if (this._currentList) {
      const newStatus = status ? 'incomplete' : 'complete';
      await markItem(this.hass!,
        this._currentList.listId,
        id,
        newStatus,
      );
      await this._fetchData();
      this.requestUpdate();
    }
  }

  private async _handleNewList() {
    if (this._newListTitle) {
      await this.hass.callService('cozi', 'add_list', {
        list_title: this._newListTitle,
        list_type: this._newListType,
      });
      this._newListTitle = '';
      this._loadLists();
      this.requestUpdate();
    }
  }

  protected render(): TemplateResult | void {
    if (this.firstrun) {
      console.info(
        `%c COZI-CARD \n%c ${localize('common.version')} ${CARD_VERSION} `,
        'color: orange; font-weight: bold; background: black',
        'color: white; font-weight: bold; background: dimgray',
      );
      this.firstrun = false;
    }

    if (!this._currentList) {
      return html`<p>Loading lists...</p>`;
    }

    return html`
      <ha-card>
        <div class="has-header">
          <ha-svg-icon
            class="addButton"
            .path=${mdiRefresh}
            @click=${this._refresh}
          ></ha-svg-icon>
          ${this.config.name || this._currentList.title}
        </div>
        <ha-select class="dropdown" label="Select List" @change=${this._handleSelect}>
          ${this._lists.map((list, index) => html`
            <mwc-list-item value="${index}" .selected=${list.listId === this._currentList.listId}>${list.title}</mwc-list-item>
          `)}
        </ha-select>
        <div class="addRow">
          <ha-svg-icon
            class="addButton"
            .path=${mdiPlus}
            .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.add_item")}
            @click=${(e) => this._handleAdd(e, 0)}
          ></ha-svg-icon>
          <ha-textfield
            class="addBox"
            .placeholder=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.add_item")}
            .value=${this._addValue}
            @input=${(e) => this._addValue = e.target.value}
            @keydown=${this._addKeyPress}
          ></ha-textfield>
          <ha-svg-icon
            class="reorderButton"
            .path=${mdiSort}
            .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.reorder_items")}
            @click=${this._toggleReorder}
          ></ha-svg-icon>
        </div>
        ${this._reordering
          ? html`
              <div id="sortable">
                ${guard([this._allItems, this._renderEmptySortable], () =>
                  this._renderEmptySortable
                    ? ""
                    : this._renderItems(this._allItems!)
                )}
              </div>
            `
          : this._renderItems(this._allItems!)}
        ${this._checkedItems!.length > 0
          ? html`
              <div class="divider"></div>
              <div class="checked">
                <span>Checked Items</span>
                <ha-svg-icon
                  class="clearall"
                  tabindex="0"
                  .path=${mdiNotificationClearAll}
                  .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.clear_items")}
                  @click=${this._clearItems}
                ></ha-svg-icon>
              </div>
            `
          : ""}
        <div class="new-list-section">
          <ha-textfield .value=${this._newListTitle} @input=${(e) => this._newListTitle = e.target.value} placeholder="New list title..."></ha-textfield>
          <ha-select .value=${this._newListType} @change=${(e) => this._newListType = e.target.value}>
            <mwc-list-item value="shopping">Shopping</mwc-list-item>
            <mwc-list-item value="todo">To-Do</mwc-list-item>
          </ha-select>
          <button class="new-list-button" @click=${this._handleNewList}>Create New List</button>
        </div>
      </ha-card>
    `;
  }

  private _renderItems(items: ShoppingListItem[]) {
    let content = html``;
    items.forEach((element) => {
      if (element.itemType === "header") {
        content = html`${content} ${this._renderHeader(element)}`;
      } else if (element.status) {
        content = html`${content} ${this._renderChecked(element)}`;
      } else {
        content = html`${content} ${this._renderUnchecked(element)}`;
      }
    });
    return content;
  }

  private _renderHeader(item: ShoppingListItem) {
    return html`
      <div class="addRow item" item=${JSON.stringify(item)}>
        <ha-svg-icon
          class="addButton"
          .path=${mdiPlus}
          .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.add_item")}
          @click=${(e) => this._handleAdd(e, item.itemPos || 0)}
        ></ha-svg-icon>
        <ha-textfield
          class="addBox"
          .placeholder=${item.text}
          .itemId=${item.itemId}
          .itemPos=${item.itemPos}
          @keydown=${this._addKeyPress}
        ></ha-textfield>
        ${this._reordering
          ? html`
              <ha-svg-icon
                .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.drag_and_drop")}
                class="reorderButton"
                .path=${mdiDrag}
              ></ha-svg-icon>
            `
          : ""}
      </div>
    `;
  }

  private _renderUnchecked(item: ShoppingListItem) {
    return html`
      <div class="editRow list-item ${item.itemType === 'header' ? 'item-header' : ''}" item=${JSON.stringify(item)}>
        <ha-checkbox
          class="item-checkbox"
          .checked=${item.status}
          .itemId=${item.itemId}
          @change=${() => this._handleMark(item.itemId, item.status)}
        ></ha-checkbox>
        ${this._editId === item.itemId ? html`
          <ha-textfield .value=${this._editValue} @input=${(e) => this._editValue = e.target.value} @blur=${() => this._saveEdit(item.itemId)}></ha-textfield>
        ` : html`
          <span class="item-text" @click=${() => this._handleEdit(item.itemId, item.text)}>${item.text}</span>
        `}
        ${this._reordering
          ? html`
              <ha-svg-icon
                .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.drag_and_drop")}
                class="reorderButton"
                .path=${mdiDrag}
              ></ha-svg-icon>
            `
          : ""}
      </div>
    `;
  }

  private _renderChecked(item: ShoppingListItem) {
    return html`
      <div class="editRow checked list-item ${item.itemType === 'header' ? 'item-header' : ''}" item=${JSON.stringify(item)}>
        <ha-checkbox
          class="item-checkbox"
          .checked=${item.status}
          .itemId=${item.itemId}
          @change=${() => this._handleMark(item.itemId, item.status)}
        ></ha-checkbox>
        ${this._editId === item.itemId ? html`
          <ha-textfield .value=${this._editValue} @input=${(e) => this._editValue = e.target.value} @blur=${() => this._saveEdit(item.itemId)}></ha-textfield>
        ` : html`
          <span class="item-text" @click=${() => this._handleEdit(item.itemId, item.text)}>${item.text}</span>
        `}
        ${this._reordering
          ? html`
              <ha-svg-icon
                .title=${this.hass!.localize("ui.panel.lovelace.cards.shopping-list.drag_and_drop")}
                class="reorderButton"
                .path=${mdiDrag}
              ></ha-svg-icon>
            `
          : ""}
      </div>
    `;
  }

  private async _refresh(): Promise<void> {
    await this.hass.callService('cozi', 'refresh');
    await this._fetchData();
  }

  private async _addItem(ev: any): Promise<void> {
    const input = ev.target.nextElementSibling || ev.target;
    let index = input.itemPos || 0;
    if (index > 0) {
      index += 1;
    }
    if (input.value.length > 0 && this._currentList) {
      await addItem(this.hass!,
        this._currentList.listId,
        input.value,
        index,
      );
      input.value = "";
      await this._fetchData();
    }
    input.focus();
  }

  private _addKeyPress(ev: KeyboardEvent): void {
    if (ev.keyCode === 13) {
      this._addItem(ev);
    }
  }

  private async _clearItems(): Promise<void> {
    if (this.hass && this._currentList) {
      const itemIds: string[] = [];
      this._checkedItems!.forEach(element => {
        itemIds.push(element.itemId);
      });
      await clearItems(this.hass,
        this._currentList.listId,
        itemIds,
      );
      await this._fetchData();
    }
  }

  private async _toggleReorder() {
    this._reordering = !this._reordering;
    await this.updateComplete;
    if (!this._reordering) {
      this._sortable?.destroy();
      this._sortable = undefined;
    }
  }

  private async _createSortable() {
    const Sortable = await loadSortable();
    const sortableEl = this._sortableEl;
    if (sortableEl) {
      this._sortable = new Sortable(sortableEl, {
        animation: 150,
        fallbackClass: "sortable-fallback",
        dataIdAttr: "item",
        handle: "ha-svg-icon",
        onEnd: async (evt) => {
          if (evt.newIndex === undefined || evt.oldIndex === undefined || evt.oldIndex === evt.newIndex) {
            return;
          }
          this._allItems!.splice(evt.newIndex, 0, this._allItems!.splice(evt.oldIndex, 1)[0]);
          const itemsList = this._allItems!.map(item => JSON.stringify(item));
          await reorderItems(this.hass!, this._currentList.listId, this._currentList.title, itemsList, this._currentList.listType).catch(() =>
            this._fetchData()
          );
          this._renderEmptySortable = true;
          await this.updateComplete;
          while (sortableEl.lastElementChild) {
            sortableEl.removeChild(sortableEl.lastElementChild);
          }
          this._renderEmptySortable = false;
        },
      });
    }
  }

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }
      ha-card {
        padding: 16px;
        height: 100%;
        box-sizing: border-box;
      }
      .has-header {
        font-family: var(--paper-font-headline_-_font-family);
        -webkit-font-smoothing: var(--paper-font-headline-_-_-webkit-font-smoothing);
        font-size: var(--paper-font-headline-_-_font-size);
        font-weight: var(--paper-font-headline-_-_font-weight);
        letter-spacing: var(--paper-font-headline-_-_letter-spacing);
        line-height: var(--paper-font-headline-_-_line-height);
        text-rendering: var(--paper-font-common-expensive-kerning-_-_text-rendering);
        opacity: var(--dark-primary-opacity);
        padding: 0px 0px 10px 0px;
        width: 100%;
      }
      .editRow,
      .addRow,
      .checked {
        display: flex;
        flex-direction: row;
        align-items: center;
      }
      .item {
        margin-top: 8px;
      }
      .addButton {
        padding-right: 16px;
        padding-inline-end: 16px;
        cursor: pointer;
        direction: var(--direction);
      }
      .reorderButton {
        padding-left: 16px;
        padding-inline-start: 16px;
        cursor: pointer;
        direction: var(--direction);
      }
      ha-checkbox {
        margin-left: -12px;
        margin-inline-start: -12px;
        direction: var(--direction);
      }
      ha-textfield {
        flex-grow: 1;
      }
      .checked {
        justify-content: space-between;
        text-decoration: line-through;
        opacity: 0.6;
      }
      .checked span {
        color: var(--primary-text-color);
        font-weight: 500;
      }
      .divider {
        height: 1px;
        background-color: var(--divider-color);
        margin: 10px 0;
      }
      .clearall {
        cursor: pointer;
      }
      .list-item:hover {
        background: var(--paper-listbox-background-color);
      }
      .item-header {
        font-weight: bold;
        color: var(--secondary-text-color);
      }
      .item-checkbox {
        margin-right: 8px;
      }
      .item-text {
        flex: 1;
      }
      .add-input {
        display: flex;
        margin-bottom: 12px;
      }
      .add-button {
        margin-left: 8px;
        background: var(--primary-color);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
      }
      .dropdown {
        margin-bottom: 12px;
        width: 100%;
      }
      .new-list-section {
        margin-top: 16px;
        border-top: 1px solid var(--divider-color);
        padding-top: 12px;
      }
      .new-list-button {
        background: var(--accent-color);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
      }
    `;
  }
}
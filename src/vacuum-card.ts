import { CSSResultGroup, html, LitElement, nothing, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  fireEvent,
  hasConfigOrEntityChanged,
  HomeAssistant,
  ServiceCallRequest,
  stateIcon,
} from 'custom-card-helpers';
import registerTemplates from './ha-template';
import get from 'lodash/get';
import localize from './localize';
import styles from './styles.css';
import buildConfig from './config';
import {
  HassEntity,
  Template,
  VacuumActionParams,
  VacuumCardAction,
  VacuumCardConfig,
  VacuumEntity,
  VacuumEntityState,
  VacuumServiceCallParams,
} from './types';
import DEFAULT_IMAGE from './vacuum.svg';

registerTemplates();

// String in the right side will be replaced by Rollup
const PKG_VERSION = 'PKG_VERSION_VALUE';

console.info(
  `%c VACUUM-CARD %c ${PKG_VERSION}`,
  'color: white; background: blue; font-weight: 700;',
  'color: blue; background: white; font-weight: 700;',
);

if (!customElements.get('ha-icon-button')) {
  customElements.define(
    'ha-icon-button',
    class extends (customElements.get('paper-icon-button') ?? HTMLElement) {},
  );
}

@customElement('vacuum-card')
export class VacuumCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private config!: VacuumCardConfig;
  @state() private requestInProgress = false;
  @state() private thumbUpdater: ReturnType<typeof setInterval> | null = null;

  static get styles(): CSSResultGroup {
    return styles;
  }

  public static async getConfigElement() {
    await import('./editor');
    return document.createElement('vacuum-card-editor');
  }

  static getStubConfig(_: unknown, entities: string[]) {
    const [vacuumEntity] = entities.filter((eid) => eid.startsWith('vacuum'));

    return {
      entity: vacuumEntity ?? '',
    };
  }

  get entity(): VacuumEntity {
    const vacuum = this.hass.states[this.config.entity] as VacuumEntity;
    return vacuum;
  }

  get map(): HassEntity | null {
    if (!this.hass || !this.config.map) {
      return null;
    }
    return this.hass.states[this.config.map];
  }

  get battery(): HassEntity | null {
    if (!this.hass || !this.config.battery) {
      return null;
    }
    return this.hass.states[this.config.battery];
  }

  get mopIntensityEntity(): string | null {
    if (!this.hass || !this.config.mop_intensity) {
      return null;
    }

    return this.config.mop_intensity;
  }

  get selectedMapEntity(): string | null {
    if (!this.hass || !this.config.selected_map) {
      return null;
    }

    return this.config.selected_map;
  }

  get waterLevelEntity(): string | null {
    if (!this.hass || !this.config.water_level) {
      return null;
    }

    return this.config.water_level;
  }

  get mopIntensity(): HassEntity | null {
    if (this.mopIntensityEntity) {
      return this.hass.states[this.mopIntensityEntity];
    }
    return null;
  }

  get selectedMap(): HassEntity | null {
    if (this.selectedMapEntity) {
      return this.hass.states[this.selectedMapEntity];
    }
    return null;
  }

  get waterLevel(): HassEntity | null {
    if (this.waterLevelEntity) {
      return this.hass.states[this.waterLevelEntity];
    }
    return null;
  }

  public setConfig(config: VacuumCardConfig): void {
    this.config = buildConfig(config);
  }

  public getCardSize(): number {
    return this.config.compact_view ? 3 : 8;
  }

  public hasWaterLevelChanged(changedProps: PropertyValues): boolean {
    if (this.waterLevelEntity === null || this.waterLevel === null) {
      return false;
    }

    return (
      this.hass &&
      !!this.config.water_level &&
      changedProps.get('hass').states[this.waterLevelEntity].state !==
        this.waterLevel.state
    );
  }

  public hasMopIntensityChanged(changedProps: PropertyValues): boolean {
    if (this.mopIntensityEntity === null || this.mopIntensity === null) {
      return false;
    }

    return (
      this.hass &&
      !!this.config.water_level &&
      changedProps.get('hass').states[this.mopIntensityEntity].state !==
        this.mopIntensity.state
    );
  }

  public hasSelectedMapChanged(changedProps: PropertyValues): boolean {
    if (this.selectedMapEntity === null || this.selectedMap === null) {
      return false;
    }

    return (
      this.hass &&
      !!this.config.water_level &&
      changedProps.get('hass').states[this.selectedMapEntity].state !==
        this.selectedMap.state
    );
  }

  public shouldUpdate(changedProps: PropertyValues): boolean {
    return (
      hasConfigOrEntityChanged(this, changedProps, false) ||
      this.hasWaterLevelChanged(changedProps) ||
      this.hasMopIntensityChanged(changedProps) ||
      this.hasSelectedMapChanged(changedProps)
    );
  }

  protected updated(changedProps: PropertyValues) {
    if (
      changedProps.get('hass') &&
      changedProps.get('hass').states[this.config.entity].state !==
        this.hass.states[this.config.entity].state
    ) {
      this.requestInProgress = false;
    }
  }

  public connectedCallback() {
    super.connectedCallback();
    if (!this.config.compact_view && this.map) {
      this.requestUpdate();
      this.thumbUpdater = setInterval(
        () => this.requestUpdate(),
        this.config.map_refresh * 1000,
      );
    }
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    if (this.map && this.thumbUpdater) {
      clearInterval(this.thumbUpdater);
    }
  }

  private handleMore(entityId: string = this.entity.entity_id): void {
    fireEvent(
      this,
      'hass-more-info',
      {
        entityId,
      },
      {
        bubbles: false,
        composed: true,
      },
    );
  }

  private callService(action: VacuumCardAction) {
    const { service, service_data, target } = action;
    const [domain, name] = service.split('.');
    this.hass.callService(domain, name, service_data, target);
  }

  private callVacuumService(
    service: ServiceCallRequest['service'],
    params: VacuumServiceCallParams = { request: true },
    options: ServiceCallRequest['serviceData'] = {},
  ) {
    this.hass.callService('vacuum', service, {
      entity_id: this.config.entity,
      ...options,
    });

    if (params.request) {
      this.requestInProgress = true;
      this.requestUpdate();
    }
  }

  private handleSpeed(e: PointerEvent): void {
    const fan_speed = (<HTMLDivElement>e.target).getAttribute('value');
    this.callVacuumService('set_fan_speed', { request: false }, { fan_speed });
  }

  private handleMopIntensitySelect(e: PointerEvent): void {
    const value = (<HTMLDivElement>e.target).getAttribute('value');
    this.hass.callService('select', 'select_option', {
      entity_id: this.mopIntensity ? this.mopIntensity.entity_id : '',
      option: value,
    });
  }

  private handleSelectedMapSelect(e: PointerEvent): void {
    const value = (<HTMLDivElement>e.target).getAttribute('value');
    this.hass.callService('select', 'select_option', {
      entity_id: this.selectedMap ? this.selectedMap.entity_id : '',
      option: value,
    });
  }

  private handleWaterLevelSelect(e: PointerEvent): void {
    const value = (<HTMLDivElement>e.target).getAttribute('value');
    this.hass.callService('select', 'select_option', {
      entity_id: this.waterLevel ? this.waterLevel.entity_id : '',
      option: value,
    });
  }

  private handleVacuumAction(
    action: string,
    params: VacuumActionParams = { request: true },
  ) {
    return () => {
      if (!this.config.actions[action]) {
        return this.callVacuumService(params.defaultService || action, params);
      }

      this.callService(this.config.actions[action]);
    };
  }

  private getAttributes(entity: VacuumEntity) {
    const { status, state } = entity.attributes;

    return {
      ...entity.attributes,
      status: status ?? state ?? entity.state,
    };
  }

  private renderSource(): Template {
    const { fan_speed: source, fan_speed_list: sources } = this.getAttributes(
      this.entity,
    );

    if (!sources || !source) {
      return nothing;
    }

    return this.renderDropDown(source, sources, 'mdi:fan', this.handleSpeed);
  }

  private renderMopIntensity(): Template {
    const entity = this.mopIntensity;

    if (!entity) {
      return nothing;
    }

    return this.renderDropDown(
      entity.state,
      entity.attributes.options,
      'mdi:water',
      this.handleMopIntensitySelect,
    );
  }

  private renderSelectedMap(): Template {
    const entity = this.selectedMap;

    if (!entity) {
      return nothing;
    }

    return this.renderDropDown(
      entity.state,
      entity.attributes.options,
      'mdi:floor-plan',
      this.handleSelectedMapSelect,
    );
  }

  private renderWaterLevel(): Template {
    const entity = this.waterLevel;

    if (!entity) {
      return nothing;
    }

    return this.renderDropDown(
      entity.state,
      entity.attributes.options,
      'mdi:water-percent',
      this.handleWaterLevelSelect,
    );
  }

  private renderDropDown(
    selectedObject: string,
    items: Record<string, any>,
    icon: string,
    onSelected: Function,
  ): Template {
    const selected = items.indexOf(selectedObject);

    return html`
      <div class="tip">
        <ha-button-menu @click="${(e: Event) => e.stopPropagation()}">
          <div slot="trigger">
            <ha-icon icon="${icon}"></ha-icon>
            <span class="icon-title">
              ${localize(`source.${selectedObject.toLowerCase()}`) ||
              selectedObject}
            </span>
          </div>
          ${items.map(
            (item: string, index: number) => html`
              <mwc-list-item
                ?activated=${selected === index}
                value=${item}
                @click=${onSelected}
              >
                ${localize(`source.${item.toLowerCase()}`) || item}
              </mwc-list-item>
            `,
          )}
        </ha-button-menu>
      </div>
    `;
  }

  private renderBattery(): Template {
    const { battery_level, battery_icon } = this.getAttributes(this.entity);
    const batteryLevel = this.battery?.state || battery_level;
    const batteryIcon = this?.battery ? stateIcon(this.battery) : battery_icon;

    if (batteryLevel && batteryIcon) {
      return html`
        <div class="tip" @click="${() => this.handleMore()}">
          <ha-icon icon="${batteryIcon}"></ha-icon>
          <span class="icon-title">${batteryLevel}%</span>
        </div>
      `;
    }
    return nothing;
  }

  private renderMapOrImage(state: VacuumEntityState): Template {
    if (this.config.compact_view) {
      return nothing;
    }

    // Only show the map when busy with a cleaning routine
    if (
      this.entity.state === 'on' ||
      this.entity.state === 'auto' ||
      this.entity.state === 'spot' ||
      this.entity.state === 'edge' ||
      this.entity.state === 'single_room' ||
      this.entity.state === 'mowing' ||
      this.entity.state === 'edgecut' ||
      this.entity.state === 'cleaning' ||
      this.entity.state === 'paused'
    ) {
      if (this.selectedMap) {
        const formattedVacuumName = this.config.entity
          .substring(7)
          .toLowerCase();

        const formattedMapName = this.selectedMap.state
          .replace(' ', '_')
          .toLowerCase();
        const mapEntityName = `image.${formattedVacuumName}_${formattedMapName}`;
        const map = this.hass.states[mapEntityName];

        return map && map.attributes.entity_picture
          ? html`
              <img
                class="map"
                src="${map.attributes.entity_picture}&v=${Date.now()}"
                @click=${() => this.handleMore(mapEntityName)}
               alt=""/>
            `
          : nothing;
      } else if (this.map) {
        return this.map && this.map.attributes.entity_picture
          ? html`
              <img
                class="map"
                src="${this.map.attributes.entity_picture}&v=${Date.now()}"
                @click=${() => this.handleMore(this.config.map)}
               alt=""/>
            `
          : nothing;
      }
    }

    const src =
      this.config.image === 'default' ? DEFAULT_IMAGE : this.config.image;
    const animated = this.config.animated ? ' animated' : '';

    return html`
      <img
        class="vacuum ${state}${animated}"
        src="${src}"
        @click="${() => this.handleMore()}"
       alt=""/>
    `;
  }

  private renderStats(state: VacuumEntityState): Template {
    const statsList =
      this.config.stats[state] || this.config.stats.default || [];

    const stats = statsList.map(
      ({ entity_id, attribute, value_template, unit, subtitle }) => {
        if (!entity_id && !attribute) {
          return nothing;
        }

        let state = '';

        if (entity_id && attribute) {
          state = get(this.hass.states[entity_id].attributes, attribute);
        } else if (attribute) {
          state = get(this.entity.attributes, attribute);
        } else if (entity_id) {
          state = this.hass.states[entity_id].state;
        } else {
          return nothing;
        }

        const value = html`
          <ha-template
            hass=${this.hass}
            template=${value_template}
            value=${state}
            variables=${{ value: state }}
          ></ha-template>
        `;

        return html`
          <div class="stats-block" @click="${() => this.handleMore(entity_id)}">
            <span class="stats-value">${value}</span>
            ${unit}
            <div class="stats-subtitle">${subtitle}</div>
          </div>
        `;
      },
    );

    if (!stats.length) {
      return nothing;
    }

    return html` <div class="stats">${stats}</div>`;
  }

  private renderName(): Template {
    const { friendly_name } = this.getAttributes(this.entity);

    if (!this.config.show_name) {
      return nothing;
    }

    return html` <div class="vacuum-name">${friendly_name}</div>`;
  }

  private renderStatus(): Template {
    const { status } = this.getAttributes(this.entity);
    if (!this.config.show_status) {
      return nothing;
    }
    let s;
    if (this.config.status_template === undefined) {
      const localizedStatus =
        localize(`status.${status.toLowerCase()}`) || status;
      s = html`
        <span class="status-text" title=${localizedStatus}>
          ${localizedStatus}
        </span>
      `;
    } else {
      s = html`
        <ha-template
          hass=${this.hass}
          template=${this.config.status_template}
          value=${status}
          variables=${{ value: status }}
        ></ha-template>
      `;
    }

    return html`
      <div class="status">
        ${s}
        <ha-circular-progress
          .indeterminate=${this?.requestInProgress}
          size="small"
          style="display: ${this?.requestInProgress ? 'flex' : 'none'}"
        >
        </ha-circular-progress>
      </div>
    `;
  }

  private renderToolbar(state: VacuumEntityState): Template {
    if (!this.config.show_toolbar) {
      return nothing;
    }

    switch (state) {
      case 'on':
      case 'auto':
      case 'spot':
      case 'edge':
      case 'single_room':
      case 'mowing':
      case 'edgecut':
      case 'cleaning': {
        return html`
          <div class="toolbar">
            <paper-button @click="${this.handleVacuumAction('pause')}">
              <ha-icon icon="hass:pause"></ha-icon>
              ${localize('common.pause')}
            </paper-button>
            <paper-button @click="${this.handleVacuumAction('stop')}">
              <ha-icon icon="hass:stop"></ha-icon>
              ${localize('common.stop')}
            </paper-button>
            <paper-button @click="${this.handleVacuumAction('return_to_base')}">
              <ha-icon icon="hass:home-map-marker"></ha-icon>
              ${localize('common.return_to_base')}
            </paper-button>
          </div>
        `;
      }

      case 'paused': {
        return html`
          <div class="toolbar">
            <paper-button
              @click="${this.handleVacuumAction('resume', {
                defaultService: 'start',
                request: true,
              })}"
            >
              <ha-icon icon="hass:play"></ha-icon>
              ${localize('common.continue')}
            </paper-button>
            <paper-button @click="${this.handleVacuumAction('return_to_base')}">
              <ha-icon icon="hass:home-map-marker"></ha-icon>
              ${localize('common.return_to_base')}
            </paper-button>
          </div>
        `;
      }

      case 'returning': {
        return html`
          <div class="toolbar">
            <paper-button
              @click="${this.handleVacuumAction('resume', {
                defaultService: 'start',
                request: true,
              })}"
            >
              <ha-icon icon="hass:play"></ha-icon>
              ${localize('common.continue')}
            </paper-button>
            <paper-button @click="${this.handleVacuumAction('pause')}">
              <ha-icon icon="hass:pause"></ha-icon>
              ${localize('common.pause')}
            </paper-button>
          </div>
        `;
      }
      case 'docked':
      case 'idle':
      default: {
        const buttons = this.config.shortcuts.map(
          ({ name, service, icon, service_data, target, link }) => {
            if (link) {
              return html` <ha-icon-button label="${name}">
                <a
                  rel="noreferrer"
                  href="${link}"
                  target="_blank"
                  style="--icon-primary-color: var(--vc-toolbar-icon-color); color: var(--vc-toolbar-icon-color);"
                >
                  <ha-icon
                    icon="${icon}"
                    style="--icon-primary-color: var(--vc-toolbar-icon-color); color: var(--vc-toolbar-icon-color);"
                  ></ha-icon>
                </a>
              </ha-icon-button>`;
            } else {
              const execute = () => {
                if (service) {
                  return this.callService({ service, service_data, target });
                }
              };
              return html`
                <ha-icon-button label="${name}" @click="${execute}">
                  <ha-icon icon="${icon}"></ha-icon>
                </ha-icon-button>
              `;
            }
          },
        );

        const dockButton = html`
          <ha-icon-button
            label="${localize('common.return_to_base')}"
            @click="${this.handleVacuumAction('return_to_base')}"
          >
            <ha-icon icon="hass:home-map-marker"></ha-icon>
          </ha-icon-button>
        `;

        return html`
          <div class="toolbar">
            <ha-icon-button
              label="${localize('common.start')}"
              @click="${this.handleVacuumAction('start')}"
            >
              <ha-icon icon="hass:play"></ha-icon>
            </ha-icon-button>

            <ha-icon-button
              label="${localize('common.locate')}"
              @click="${this.handleVacuumAction('locate', { request: false })}"
            >
              <ha-icon icon="mdi:map-marker"></ha-icon>
            </ha-icon-button>

            ${state === 'idle' ? dockButton : ''}
            <div class="fill-gap"></div>
            ${buttons}
          </div>
        `;
      }
    }
  }

  private renderUnavailable(): Template {
    return html`
      <ha-card>
        <div class="preview not-available">
          <div class="metadata">
            <div class="not-available">
              ${localize('common.not_available')}
            </div>
            <div>
            </div>
      </ha-card>
    `;
  }

  protected render(): Template {
    if (!this.entity) {
      return this.renderUnavailable();
    }

    return html`
      <ha-card>
        <div class="preview">
          <div class="header">
            <div class="tips">
              ${this.renderSource()} ${this.renderMopIntensity()}
              ${this.renderWaterLevel()} ${this.renderSelectedMap()}
              ${this.renderBattery()}
            </div>
            <ha-icon-button
              class="more-info"
              icon="mdi:dots-vertical"
              ?more-info="true"
              @click="${() => this.handleMore()}"
            >
              <ha-icon icon="mdi:dots-vertical"></ha-icon>
            </ha-icon-button>
          </div>

          ${this.renderMapOrImage(this.entity.state)}

          <div class="metadata">
            ${this.renderName()} ${this.renderStatus()}
          </div>

          ${this.renderStats(this.entity.state)}
        </div>

        ${this.renderToolbar(this.entity.state)}
      </ha-card>
    `;
  }
}

declare global {
  interface Window {
    customCards?: unknown[];
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  preview: true,
  type: 'vacuum-card',
  name: localize('common.name'),
  description: localize('common.description'),
});

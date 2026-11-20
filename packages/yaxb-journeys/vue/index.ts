import { defineAsyncComponent } from "vue";
// @sekaran-ind/yaxb-journeys/vue: Vue 3 components for Service → Journey → Questionnaire.
// Import the styles once: import "@sekaran-ind/yaxb-journeys/style.css".
import "./style.css";

export { default as AdaptiveNav } from "./AdaptiveNav.vue";
export type { NavScreen } from "./AdaptiveNav.vue";
export { default as ConfirmAction } from "./ConfirmAction.vue";
export { default as FlowDiagram } from "./FlowDiagram.vue";
export { default as FlowPreview } from "./FlowPreview.vue";
export { default as FlowStudio } from "./FlowStudio.vue";
export { default as JourneyDesigner } from "./JourneyDesigner.vue";
export { default as JourneyRunner } from "./JourneyRunner.vue";
export { default as JourneyTasks } from "./JourneyTasks.vue";
export { default as PopMenu } from "./PopMenu.vue";
export { default as QuestionField } from "./QuestionField.vue";
export type { LanguageOption, SourceOption } from "./QuestionField.vue";
export { default as QuestionnaireForm } from "./QuestionnaireForm.vue";
export { default as RolePicker } from "./RolePicker.vue";
export { default as RolesPanel } from "./RolesPanel.vue";
export { default as ServiceDesigner } from "./ServiceDesigner.vue";
export { default as ServiceSummary } from "./ServiceSummary.vue";
export { default as ServiceItems } from "./ServiceItems.vue";
export { default as StructureTree } from "./StructureTree.vue";
export { default as YamlEditor } from "./YamlEditor.vue";
export { ICONS_KEY, provideIcons, useIcons, type IconResolver } from "./icons";
export { default as MediaCapture } from "./MediaCapture.vue";
// Maps (VIS-1, VIS-5): each loads Leaflet in its own chunk.
export const GeoPicker = defineAsyncComponent(() => import("./GeoPicker.vue"));
export const MapView = defineAsyncComponent(() => import("./MapView.vue"));
export type { MapPlace } from "./MapView.vue";
// Charts, timelines and display blocks (VIS-3, VIS-4, VIS-6): Observable Plot and d3 load with them only.
export const PlotChart = defineAsyncComponent(() => import("./PlotChart.vue"));
export const EventTimeline = defineAsyncComponent(() => import("./EventTimeline.vue"));
export { default as DisplayBlocks } from "./DisplayBlocks.vue";
export type { ChartPoint } from "./PlotChart.vue";
export type { TimelineItem } from "./EventTimeline.vue";
export { DEFAULT_VIEW, GEO_KEY, OSM_TILES, provideGeo, useGeo, type GeoHost, type PlaceHit } from "./geo";
export { MEDIA_KEY, mediaRefOf, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, provideMedia, shrinkPhoto, useMedia, type MediaHost } from "./media";

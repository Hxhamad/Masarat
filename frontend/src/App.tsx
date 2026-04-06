import Header from './components/Header/Header';
import FlightMap from './components/Map/FlightMap';
import FIRLayer from './components/Map/FIRLayer';
import WeatherRadarLayer from './components/Map/WeatherRadarLayer';
import WeatherMetarLayer from './components/Map/WeatherMetarLayer';
import WeatherAlertLayer from './components/Map/WeatherAlertLayer';
import GNSSHeatmapLayer from './components/Map/GNSSHeatmapLayer';
import DenseFlightLayer from './components/Map/DenseFlightLayer';
import Legend from './components/Map/Legend';
import LayerLegend from './components/Map/LayerLegend';
import ADSBPanel from './components/ADSBPanel/ADSBPanel';
import InfoPanel from './components/InfoPanel/InfoPanel';
import LayerPanel from './components/LayerPanel/LayerPanel';
import StatusBar from './components/StatusBar/StatusBar';
import FIRSelectionModal from './components/FIRSelectionModal/FIRSelectionModal';
import VisibleFlightsDriver from './components/VisibleFlightsDriver';
import { useWebSocket } from './hooks/useWebSocket';
import { useWeatherPolling } from './hooks/useWeatherPolling';
import { useGNSSPolling } from './hooks/useGNSSPolling';
import { useFIRStore } from './stores/firStore';
import { useUIStore } from './stores/uiStore';

export default function App() {
  useWebSocket();
  useWeatherPolling();
  useGNSSPolling();
  const firSetupComplete = useFIRStore((s) => s.firSetupComplete);
  const { layerPanelOpen, setLayerPanelOpen } = useUIStore();

  return (
    <div className="app-shell">
      <div className="app-shell__ambient app-shell__ambient--rose" aria-hidden="true" />
      <div className="app-shell__ambient app-shell__ambient--cyan" aria-hidden="true" />
      <Header />
      <VisibleFlightsDriver />
      <FlightMap />
      <FIRLayer />
      <WeatherRadarLayer />
      <WeatherMetarLayer />
      <WeatherAlertLayer />
      <GNSSHeatmapLayer />
      <DenseFlightLayer />
      <Legend />
      <LayerLegend />
      <ADSBPanel />
      <InfoPanel />
      <LayerPanel open={layerPanelOpen} onClose={() => setLayerPanelOpen(false)} />
      <StatusBar />
      {!firSetupComplete && <FIRSelectionModal />}
    </div>
  );
}

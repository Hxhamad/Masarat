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
import StatusBar from './components/StatusBar/StatusBar';
import FIRSelectionModal from './components/FIRSelectionModal/FIRSelectionModal';
import VisibleFlightsDriver from './components/VisibleFlightsDriver';
import { useWebSocket } from './hooks/useWebSocket';
import { useWeatherPolling } from './hooks/useWeatherPolling';
import { useGNSSPolling } from './hooks/useGNSSPolling';
import { useFIRStore } from './stores/firStore';

export default function App() {
  useWebSocket();
  useWeatherPolling();
  useGNSSPolling();
  const firSetupComplete = useFIRStore((s) => s.firSetupComplete);

  return (
    <>
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
      <StatusBar />
      {!firSetupComplete && <FIRSelectionModal />}
    </>
  );
}

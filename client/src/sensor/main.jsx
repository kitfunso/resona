import React from 'react';
import { createRoot } from 'react-dom/client';
import SensorApp from './SensorApp.jsx';
import './sensor.css';

createRoot(document.getElementById('root')).render(<SensorApp />);

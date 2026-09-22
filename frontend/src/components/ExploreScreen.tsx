import React, { useState } from 'react';
import { ExploreMapPin, ExploreCollectionItem } from '../types';

interface ExploreScreenProps {
  pins: ExploreMapPin[];
  collections: ExploreCollectionItem[];
  onSelectPin?: (pin: ExploreMapPin) => void;
}

export const ExploreScreen: React.FC<ExploreScreenProps> = ({
  pins,
  collections,
  onSelectPin
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  return (
    <div className="screen-explore-container">
      {/* 顶部搜索与区域选择控件 */}
      <div className="explore-floating-controls">
        <button type="button" className="pill-region-selector">
          <span>中国</span>
          <span className="down-caret">⌵</span>
        </button>
        <button type="button" className="pill-search-btn" aria-label="搜索探索目的地">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </div>

      {/* 浅绿清新地图交互画布 */}
      <div className="explore-map-canvas">
        <div className="map-grid-lines"></div>
        <div className="map-curved-road-1"></div>
        <div className="map-curved-road-2"></div>

        {/* 地图上的灵感图钉气泡 */}
        {pins.map((pin) => (
          <div
            key={pin.id}
            className="map-inspiration-bubble"
            style={{ top: `${pin.topPercent}%`, left: `${pin.leftPercent}%` }}
            onClick={() => onSelectPin && onSelectPin(pin)}
          >
            <div className="bubble-avatar-box">
              <div className="avatar-mini-circle"></div>
            </div>
            <div className="bubble-text-content">
              <div className="bubble-pin-title">{pin.title}</div>
              <div className="bubble-pin-city">{pin.cityName}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 底部上拉抽屉：看看大家的收藏夹 */}
      <div className={`explore-bottom-sheet ${isDrawerOpen ? 'sheet-expanded' : 'sheet-collapsed'}`}>
        <div className="sheet-handle-bar" onClick={() => setIsDrawerOpen(!isDrawerOpen)}>
          <div className="handle-dash"></div>
        </div>

        <div className="sheet-header-row">
          <h3 className="sheet-title">看看大家的收藏夹</h3>
          <label className="toggle-switch-ui" aria-label="切换收藏夹展示">
            <input
              type="checkbox"
              checked={isDrawerOpen}
              onChange={(e) => setIsDrawerOpen(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {isDrawerOpen && (
          <div className="sheet-collection-list">
            {collections.map((item) => (
              <div key={item.id} className="sheet-collection-card">
                <div className="collection-card-name">{item.title}</div>
                <div className="collection-card-meta">{item.detailMeta}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

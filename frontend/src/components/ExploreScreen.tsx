import React, { useState, useMemo } from 'react';
import { ExploreMapPin, ExploreCollectionItem } from '../types';
import { Icon } from './Icon';

interface ExploreScreenProps {
  pins: ExploreMapPin[];
  collections: ExploreCollectionItem[];
  onSelectPin?: (pin: ExploreMapPin) => void;
  onSelectCollection?: (collection: ExploreCollectionItem) => void;
}

const REGION_OPTIONS = [
  { key: 'all', label: '中国' },
  { key: '四川', label: '四川' },
  { key: '云南', label: '云南' },
  { key: '国际', label: '国际' }
] as const;

export const ExploreScreen: React.FC<ExploreScreenProps> = ({
  pins,
  collections,
  onSelectPin,
  onSelectCollection
}) => {
  // 底部抽屉展开/收起
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  // 搜索关键字
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  // 地区选择
  const [currentRegion, setCurrentRegion] = useState<string>('中国');
  const [isRegionMenuOpen, setIsRegionMenuOpen] = useState(false);
  // 当前选中的图钉（弹出浮层卡片）
  const [selectedPin, setSelectedPin] = useState<ExploreMapPin | null>(null);

  // 根据地区与搜索关键字过滤图钉
  const filteredPins = useMemo(() => {
    return pins.filter((pin) => {
      const matchRegion = currentRegion === '中国' 
        ? (pin.region !== '国际') 
        : (pin.region === currentRegion || pin.cityName.includes(currentRegion));
      if (!matchRegion) return false;
      if (!searchKeyword.trim()) return true;
      const kw = searchKeyword.trim().toLowerCase();
      return pin.title.toLowerCase().includes(kw) || 
             pin.cityName.toLowerCase().includes(kw) ||
             pin.tags?.some(t => t.toLowerCase().includes(kw));
    });
  }, [pins, currentRegion, searchKeyword]);

  // 过滤收藏夹
  const filteredCollections = useMemo(() => {
    if (!searchKeyword.trim()) return collections;
    const kw = searchKeyword.trim().toLowerCase();
    return collections.filter(c => 
      c.title.toLowerCase().includes(kw) || 
      c.detailMeta.toLowerCase().includes(kw) ||
      c.tags?.some(t => t.toLowerCase().includes(kw))
    );
  }, [collections, searchKeyword]);

  const handlePinClick = (pin: ExploreMapPin) => {
    setSelectedPin(pin);
  };

  const handleConfirmPlanPin = (pin: ExploreMapPin) => {
    if (onSelectPin) {
      onSelectPin(pin);
    }
  };

  return (
    <div className="screen-explore-container">
      {/* 顶部搜索与区域选择控件 */}
      <div className="explore-floating-controls">
        {!isSearchActive ? (
          <>
            <div className="region-dropdown-wrapper">
              <button
                type="button"
                className="pill-region-selector"
                onClick={() => setIsRegionMenuOpen(!isRegionMenuOpen)}
                aria-label="选择探索地区"
              >
                <span>{currentRegion}</span>
                <Icon name="chevron-down" size={14} className="down-caret" />
              </button>

              {isRegionMenuOpen && (
                <div className="region-dropdown-menu">
                  {REGION_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`region-menu-item ${currentRegion === item.label ? 'region-menu-item-active' : ''}`}
                      onClick={() => {
                        setCurrentRegion(item.label);
                        setIsRegionMenuOpen(false);
                        setSelectedPin(null);
                      }}
                    >
                      <span>{item.label}</span>
                      {currentRegion === item.label && <Icon name="check" size={14} className="check-mark" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="pill-search-btn"
              aria-label="搜索探索目的地"
              onClick={() => setIsSearchActive(true)}
            >
              <Icon name="search" size={18} />
            </button>
          </>
        ) : (
          <div className="explore-search-bar-inline">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索目的地、景点或风格灵感..."
              className="explore-search-input"
              autoFocus
            />
            <button type="button" className="btn-close-search" onClick={() => { setIsSearchActive(false); setSearchKeyword(''); }} aria-label="关闭搜索">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>

      {/* 浅绿清新地图交互画布 */}
      <div className="explore-map-canvas">
        <div className="map-grid-lines"></div>
        <div className="map-curved-road-1"></div>
        <div className="map-curved-road-2"></div>
        <div className="map-curved-river"></div>

        {/* 地图上的灵感图钉气泡 */}
        {filteredPins.map((pin, index) => (
          <div
            key={pin.id}
            className={`map-inspiration-bubble ${selectedPin?.id === pin.id ? 'bubble-pin-active' : ''}`}
            style={{ top: `${pin.topPercent}%`, left: `${pin.leftPercent}%` }}
            onClick={() => handlePinClick(pin)}
            role="button"
            tabIndex={0}
            aria-label={`${pin.title} · ${pin.cityName}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handlePinClick(pin);
              }
            }}
          >
            <div className="bubble-avatar-box">
              <img
                className="avatar-mini-circle"
                src={`/spots/spot-${(index % 3) + 1}-960.webp`}
                srcSet={`/spots/spot-${(index % 3) + 1}-480.webp 480w, /spots/spot-${(index % 3) + 1}-960.webp 960w, /spots/spot-${(index % 3) + 1}-1440.webp 1440w`}
                sizes="24px"
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
                alt=""
                style={{ objectFit: 'cover' }}
              />
            </div>
            <div className="bubble-text-content">
              <div className="bubble-pin-title">{pin.title}</div>
              <div className="bubble-pin-city">{pin.cityName}</div>
            </div>
          </div>
        ))}

        {/* 点击图钉弹出的详情微卡片 */}
        {selectedPin && (
          <div className="map-pin-popover-card">
            <div className="popover-card-header">
              <div className="popover-title-row">
                <span className="popover-city-badge">{selectedPin.cityName}</span>
                <h4 className="popover-pin-title">{selectedPin.title}</h4>
              </div>
              <button type="button" className="btn-close-popover" onClick={() => setSelectedPin(null)} aria-label="关闭地点详情">
                <Icon name="close" size={15} />
              </button>
            </div>

            {selectedPin.description && (
              <p className="popover-pin-desc">{selectedPin.description}</p>
            )}

            {selectedPin.tags && selectedPin.tags.length > 0 && (
              <div className="popover-tags-row">
                {selectedPin.tags.map((t, idx) => (
                  <span key={idx} className="popover-tag-chip">#{t}</span>
                ))}
              </div>
            )}

            <div className="popover-actions-row">
              <button
                type="button"
                className="btn-popover-plan-action"
                onClick={() => handleConfirmPlanPin(selectedPin)}
              >
                <span><Icon name="robot" size={15} /> 让智能体排进路线</span>
                <Icon name="arrow-right" size={16} />
              </button>
            </div>
          </div>
        )}
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
          <div className="sheet-collection-list" role="list">
            {filteredCollections.map((item) => (
              <div
                key={item.id}
                className="sheet-collection-card"
                role="button"
                tabIndex={0}
                onClick={() => onSelectCollection && onSelectCollection(item)}
                title="点击让智能体规划该收藏夹路线"
              >
                <div className="collection-card-left">
                  <div className="collection-card-name">{item.title}</div>
                  <div className="collection-card-meta">{item.detailMeta}</div>
                  {item.description && (
                    <div className="collection-card-desc">{item.description}</div>
                  )}
                </div>

                <div className="collection-card-arrow"><Icon name="arrow-right" size={15} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

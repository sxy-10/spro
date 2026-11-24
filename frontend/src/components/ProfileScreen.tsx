import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BookingScreen } from './BookingScreen';
import { Icon } from './Icon';
import {
  ProfileFavoriteItem,
  ProfileSubscriptionItem,
  ProfileFootprintItem,
  ProfileCollectionPassItem
} from '../types';
import {
  defaultProfileFavorites,
  defaultProfileSubscriptions,
  defaultProfileFootprints,
  defaultProfileCollectionPasses
} from '../mockData';

type ActiveModalType = 'favorites' | 'subscriptions' | 'footprint' | 'collection' | 'settings' | 'editProfile' | null;

interface ProfileScreenProps {
  onOpenAdminConsole: () => void;
  nickname: string;
  isAdmin: boolean;
  isLoggedIn?: boolean;
  onLogout: () => void;
  onOpenLogin?: () => void;
  onNavigateToAgent?: (prompt: string) => void;
  defaultMobile?: string;
}

const AVATAR_EMOJI_OPTIONS = ['🐼', '🏔️', '🎒', '✈️', '🌊', '🧳'];

/** 头像最长边像素。localStorage 只有 5MB，原图直接存会写爆，统一缩到 256 */
const AVATAR_MAX_EDGE = 256;

/** 判断本地存的是本机图片（data URL）还是内置 emoji */
const isImageAvatarValue = (value: string) => value.startsWith('data:image/');

/** 读取本机图片并等比缩小为 JPEG data URL */
function readLocalImageAsAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('canvas 不可用'));
        return;
      }
      // JPEG 不支持透明，先铺白底，避免 PNG 透明区变黑
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片解码失败'));
    };
    image.src = objectUrl;
  });
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  onOpenAdminConsole,
  nickname,
  isAdmin,
  isLoggedIn = true,
  onLogout,
  onOpenLogin,
  onNavigateToAgent,
  defaultMobile
}) => {
  // 弹窗状态
  const [activeModal, setActiveModal] = useState<ActiveModalType>(null);

  // 收藏夹状态
  const [favorites, setFavorites] = useState<ProfileFavoriteItem[]>(defaultProfileFavorites);
  const [favoriteCategory, setFavoriteCategory] = useState<'全部' | '路线' | '景点' | '美食'>('全部');

  // 订阅话题状态
  const [subscriptions, setSubscriptions] = useState<ProfileSubscriptionItem[]>(defaultProfileSubscriptions);

  // 足迹状态
  const [footprints, setFootprints] = useState<ProfileFootprintItem[]>(defaultProfileFootprints);
  const [newCityName, setNewCityName] = useState('');
  const [newCityProvince, setNewCityProvince] = useState('');
  const [showAddCityForm, setShowAddCityForm] = useState(false);

  // 采集凭证状态
  const [collectionPasses] = useState<ProfileCollectionPassItem[]>(defaultProfileCollectionPasses);
  const [selectedPass, setSelectedPass] = useState<ProfileCollectionPassItem | null>(null);

  // 偏好设置状态
  const [preferences, setPreferences] = useState({
    zeroTurnaround: true,
    purePlayNoShopping: true,
    antiCrowdAlert: true,
    budgetLevel: '品质轻奢 (¥5k-10k)'
  });

  // 用户资料自定义（持久化于本地）
  const [customNickname, setCustomNickname] = useState(() => {
    return localStorage.getItem('profile_nickname') || nickname || '旅行家';
  });
  const [customAvatar, setCustomAvatar] = useState(() => {
    return localStorage.getItem('profile_avatar') || '🐼';
  });
  // 提示信息 Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  // 本机图片上传：隐藏的 file input 由「从本机选择图片」按钮触发
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [isReadingAvatarImage, setIsReadingAvatarImage] = useState(false);

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同一个文件连续选两次也要能触发 change，所以读完就清空
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件（JPG / PNG / WebP）');
      return;
    }
    setIsReadingAvatarImage(true);
    try {
      setCustomAvatar(await readLocalImageAsAvatar(file));
    } catch {
      showToast('图片读取失败，请换一张试试');
    } finally {
      setIsReadingAvatarImage(false);
    }
  };

  useEffect(() => {
    if (nickname && nickname !== '旅行家' && !localStorage.getItem('profile_nickname')) {
      setCustomNickname(nickname);
    }
  }, [nickname]);

  // 当弹窗打开时锁定背景滚动，防止蒙层随底层页面上移或漏出底层卡片
  useEffect(() => {
    const screenBody = document.querySelector('.mobile-screen-body') as HTMLElement | null;
    if (!screenBody) return;
    if (activeModal) {
      const prevOverflow = screenBody.style.overflow;
      screenBody.style.overflow = 'hidden';
      return () => {
        screenBody.style.overflow = prevOverflow;
      };
    }
  }, [activeModal]);

  // 过滤后的收藏列表
  const filteredFavorites = useMemo(() => {
    if (favoriteCategory === '全部') return favorites;
    return favorites.filter((f) => f.category === favoriteCategory);
  }, [favorites, favoriteCategory]);

  // 统计已点亮省份
  const visitedProvinces = useMemo(() => {
    const set = new Set<string>();
    footprints.forEach((f) => {
      if (f.provinceName) set.add(f.provinceName);
    });
    return Array.from(set);
  }, [footprints]);

  // 移除收藏
  const handleRemoveFavorite = (favId: string, favTitle: string) => {
    setFavorites((prev) => prev.filter((item) => item.id !== favId));
    showToast(`已从收藏夹移除「${favTitle}」`);
  };

  // 切换订阅状态
  const handleToggleSubscription = (subId: string) => {
    setSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id === subId) {
          const nextStatus = !sub.enabled;
          showToast(nextStatus ? `已开启「${sub.title}」推送` : `已暂停「${sub.title}」推送`);
          return { ...sub, enabled: nextStatus };
        }
        return sub;
      })
    );
  };

  // 唤起智能体规划
  const handleLaunchAgent = (promptText: string) => {
    setActiveModal(null);
    if (onNavigateToAgent) {
      onNavigateToAgent(promptText);
    }
  };

  // 点亮新城市
  const handleAddFootprint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCityName.trim()) return;
    const newFp: ProfileFootprintItem = {
      id: `fp_${Date.now()}`,
      cityName: newCityName.trim(),
      provinceName: newCityProvince.trim() || '其他',
      yearString: '2026',
      countryCode: '🇨🇳',
      description: '新近打卡探索 · 智能体与行程判官全程护航'
    };
    setFootprints((prev) => [newFp, ...prev]);
    setNewCityName('');
    setNewCityProvince('');
    setShowAddCityForm(false);
    showToast(`🎉 成功点亮新城市「${newFp.cityName}」！`);
  };

  // 保存个人资料
  const handleSaveProfile = (nick: string, av: string) => {
    setCustomNickname(nick);
    setCustomAvatar(av);
    localStorage.setItem('profile_nickname', nick);
    localStorage.setItem('profile_avatar', av);
    setActiveModal(null);
    showToast('个人资料已成功更新');
  };

  // 清理本地缓存
  const handleClearCache = () => {
    localStorage.removeItem('travel_deepseek_api_key');
    showToast('✨ 本地临时行程缓存已清理完成');
  };

  return (
    <div className="screen-profile-container">
      {/* 浮动轻量 Toast 反馈 */}
      {toastMessage && <div className="profile-floating-toast">{toastMessage}</div>}

      {/* 顶部标题栏 */}
      <div className="profile-top-header">
        <h2 className="profile-header-title">我的</h2>
        <button
          type="button"
          className="nav-icon-button"
          aria-label="设置菜单"
          onClick={() => setActiveModal('settings')}
          title="偏好设置"
        >
          <Icon name="settings" size={22} />
        </button>
      </div>

      {/* 用户基本信息名片 */}
      <div className="profile-user-card">
        <div
          className="user-avatar-circle"
          onClick={() => setActiveModal('editProfile')}
          title="点击更换头像与昵称"
        >
          {isImageAvatarValue(customAvatar) ? (
            <img className="user-avatar-image" src={customAvatar} alt="我的头像" />
          ) : (
            <span>{customAvatar}</span>
          )}
        </div>
        <div className="user-text-info">
          <div className="user-nickname-row">
            <span className="user-nickname">{customNickname}</span>
            <button
              type="button"
              className="btn-edit-nickname-mini"
              onClick={() => setActiveModal('editProfile')}
              aria-label="编辑昵称"
            >
              <Icon name="edit" size={14} />
            </button>
          </div>
          <div className="user-membership-badge">
            {isLoggedIn ? (isAdmin ? '平台超级管理员' : '智能体验深度定制会员') : '游客体验模式 (免登录畅享)'}
          </div>
        </div>
        {!isLoggedIn && onOpenLogin && (
          <button type="button" className="pill-login-btn" onClick={onOpenLogin}>
            登录/注册
          </button>
        )}
      </div>

      {/* 收藏与订阅双统计卡片 */}
      <div className="profile-stats-grid">
        <div
          className="stat-pill-card"
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal('favorites')}
        >
          <div className="stat-title-label">我的收藏</div>
          <div className="stat-count-sub">收藏夹 · {favorites.length}</div>
        </div>
        <div
          className="stat-pill-card"
          role="button"
          tabIndex={0}
          onClick={() => setActiveModal('subscriptions')}
        >
          <div className="stat-title-label">我的订阅</div>
          <div className="stat-count-sub">话题夹 · {subscriptions.filter((s) => s.enabled).length} 活跃</div>
        </div>
      </div>

      {/* 我的足迹卡片 */}
      <div
        className="profile-footprint-card"
        role="button"
        tabIndex={0}
        onClick={() => setActiveModal('footprint')}
        title="点击查看打卡城市与足迹详情"
      >
        <div className="card-inner-header">
          <div className="footprint-main-title">
            <span>我的足迹</span>
            <Icon name="arrow-right" size={14} className="card-arrow-mini" />
          </div>
          <div className="footprint-subtitle">
            已点亮 1 个国家，{footprints.length} 个城市 · {visitedProvinces.length} 个省份
          </div>
        </div>

        <div className="footprint-tags-row">
          <span className="country-flag-icon">🇨🇳</span>
          <div className="provinces-chips">
            {visitedProvinces.slice(0, 5).map((prov, idx) => (
              <React.Fragment key={prov}>
                {idx > 0 && <span className="chip-dot">·</span>}
                <span className="province-chip">{prov}</span>
              </React.Fragment>
            ))}
            {visitedProvinces.length > 5 && <span className="province-chip">+{visitedProvinces.length - 5}</span>}
          </div>
        </div>
      </div>

      {/* 我的采集卡片 */}
      <div
        className="profile-collection-card"
        role="button"
        tabIndex={0}
        onClick={() => setActiveModal('collection')}
        title="点击查看收藏的电子票券与认证证书"
      >
        <div className="collection-card-title">
          <span>我的采集 · {collectionPasses.length}</span>
          <Icon name="arrow-right" size={14} className="card-arrow-mini" />
        </div>
        <div className="collection-card-desc">
          景点纪念票根、电子手账徽章与行程判官认证文件
        </div>
      </div>

      {/* 线路预订卡片 */}
      <BookingScreen
        defaultMobile={defaultMobile}
        isLoggedIn={isLoggedIn}
        onOpenLogin={onOpenLogin}
      />

      {/* 管理中台快捷入口 */}
      {isAdmin && (
        <div
          className="profile-admin-entrance-card"
          onClick={onOpenAdminConsole}
          role="button"
          tabIndex={0}
        >
          <div className="admin-entrance-left">
            <div className="entrance-title">旅行社智能体管理中台</div>
            <div className="entrance-desc">查看全网行程并发、转化漏斗与人设引擎</div>
          </div>
          <div className="entrance-arrow"><Icon name="arrow-right" size={16} /></div>
        </div>
      )}

      {/* 登录/退出登录按钮 */}
      {isLoggedIn ? (
        <button type="button" className="profile-logout-button" onClick={onLogout}>
          <Icon name="logout" size={15} />
          <span>退出登录</span>
        </button>
      ) : (
        <button type="button" className="profile-login-button" onClick={onOpenLogin}>
          <span><Icon name="lock" size={15} /> 登录 / 注册账号（同步云端资产）</span>
        </button>
      )}

      {/* ========================================================
          弹窗 1：【我的收藏】（Favorites Modal）
         ======================================================== */}
      {activeModal === 'favorites' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-title-box">
                <h3 className="modal-title"><Icon name="star" size={17} className="modal-title-icon" />我的收藏</h3>
                <span className="modal-badge-count">{favorites.length} 个灵感</span>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            {/* 分类过滤 Tab */}
            <div className="modal-segment-tabs">
              {(['全部', '路线', '景点', '美食'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`modal-segment-btn ${favoriteCategory === tab ? 'active' : ''}`}
                  onClick={() => setFavoriteCategory(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 收藏列表 */}
            <div className="modal-scroll-list">
              {filteredFavorites.length === 0 ? (
                <div className="modal-empty-state">暂无该分类的收藏内容</div>
              ) : (
                filteredFavorites.map((item) => (
                  <div key={item.id} className="profile-fav-card">
                    <div className="fav-card-top">
                      <span className="fav-category-tag">{item.category}</span>
                      <h4 className="fav-card-title">{item.title}</h4>
                      <span className="fav-badge-status">{item.badgeText}</span>
                    </div>
                    <p className="fav-card-desc">{item.description}</p>
                    <div className="fav-card-footer">
                      <button
                        type="button"
                        className="btn-remove-fav"
                        onClick={() => handleRemoveFavorite(item.id, item.title)}
                      >
                        取消收藏
                      </button>
                      <button
                        type="button"
                        className="btn-plan-fav"
                        onClick={() => handleLaunchAgent(item.planPrompt)}
                      >
                        <span><Icon name="sparkles" size={14} /> 让智能体规划</span>
                        <Icon name="arrow-right" size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          弹窗 2：【我的订阅】（Subscriptions Modal）
         ======================================================== */}
      {activeModal === 'subscriptions' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-title-box">
                <h3 className="modal-title"><Icon name="bell" size={17} className="modal-title-icon" />我的订阅与实时预警雷达</h3>
                <span className="modal-badge-count">
                  {subscriptions.filter((s) => s.enabled).length} 个开启中
                </span>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            <p className="modal-intro-text">
              由行程判官与全网出行 API 协同监控，第一时间捕获索道维保、降价优惠与气象路况。
            </p>

            <div className="modal-scroll-list">
              {subscriptions.map((sub) => (
                <div key={sub.id} className="profile-sub-card">
                  <div className="sub-card-header">
                    <div className="sub-title-row">
                      <h4 className="sub-card-title">{sub.title}</h4>
                      <span className="sub-freq-chip">{sub.frequency}</span>
                    </div>
                    <label className="toggle-switch-ui" aria-label={`切换订阅 ${sub.title}`}>
                      <input
                        type="checkbox"
                        checked={sub.enabled}
                        onChange={() => handleToggleSubscription(sub.id)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  <p className="sub-card-desc">{sub.description}</p>
                  <div className="sub-card-footer">
                    <span className={`sub-status-indicator ${sub.enabled ? 'active' : 'inactive'}`}>
                      {sub.enabled ? (
                        <><span className="status-dot" style={{ background: '#10b981' }} />正在后台实时监控</>
                      ) : (
                        <><span className="status-dot" style={{ background: '#9ca3af' }} />监控已暂停</>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn-check-radar"
                      onClick={() => handleLaunchAgent(sub.checkPrompt)}
                    >
                      <span>查看今日情报 <Icon name="arrow-right" size={13} /></span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          弹窗 3：【我的足迹】（Footprints Modal）
         ======================================================== */}
      {activeModal === 'footprint' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-title-box">
                <h3 className="modal-title"><Icon name="map" size={17} className="modal-title-icon" />我的旅行足迹</h3>
                <span className="modal-badge-count">{footprints.length} 个城市</span>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            <div className="footprint-stats-summary-bar">
              <div className="fp-summary-item">
                <div className="fp-num">1</div>
                <div className="fp-label">国家/地区</div>
              </div>
              <div className="fp-summary-item">
                <div className="fp-num">{visitedProvinces.length}</div>
                <div className="fp-label">省份点亮</div>
              </div>
              <div className="fp-summary-item">
                <div className="fp-num">{footprints.length}</div>
                <div className="fp-label">探索城市</div>
              </div>
              <div className="fp-summary-item">
                <div className="fp-num">1,280</div>
                <div className="fp-label">总里程 km</div>
              </div>
            </div>

            {/* 点亮新城市操作 */}
            {!showAddCityForm ? (
              <button
                type="button"
                className="btn-trigger-add-city"
                onClick={() => setShowAddCityForm(true)}
              >
                <span>+ 点亮新探索的城市</span>
              </button>
            ) : (
              <form className="add-city-form" onSubmit={handleAddFootprint}>
                <div className="add-city-inputs">
                  <input
                    type="text"
                    placeholder="城市名称 (如：西安)"
                    value={newCityName}
                    onChange={(e) => setNewCityName(e.target.value)}
                    className="city-input"
                    autoFocus
                    required
                  />
                  <input
                    type="text"
                    placeholder="所属省份 (如：陕西)"
                    value={newCityProvince}
                    onChange={(e) => setNewCityProvince(e.target.value)}
                    className="city-input"
                  />
                </div>
                <div className="add-city-actions">
                  <button type="button" className="btn-cancel-add" onClick={() => setShowAddCityForm(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn-confirm-add">
                    确认点亮
                  </button>
                </div>
              </form>
            )}

            <div className="modal-scroll-list">
              {footprints.map((fp) => (
                <div key={fp.id} className="footprint-timeline-item">
                  <div className="fp-flag-avatar">{fp.countryCode}</div>
                  <div className="fp-info-content">
                    <div className="fp-city-row">
                      <span className="fp-city-name">{fp.cityName}</span>
                      <span className="fp-province-name">{fp.provinceName}</span>
                      <span className="fp-year-badge">{fp.yearString}年</span>
                    </div>
                    <p className="fp-desc-text">{fp.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          弹窗 4：【我的采集】（Collection & Digital Passes）
         ======================================================== */}
      {activeModal === 'collection' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div className="modal-title-box">
                <h3 className="modal-title"><Icon name="ticket" size={17} className="modal-title-icon" />我的采集与电子票夹</h3>
                <span className="modal-badge-count">{collectionPasses.length} 张凭证</span>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            <p className="modal-intro-text">
              沉淀您在每一次旅途中的纪念票根、电子徽章与行程判官官方认证档案。
            </p>

            <div className="modal-scroll-list">
              {collectionPasses.map((pass) => (
                <div
                  key={pass.id}
                  className={`profile-pass-ticket-card ${selectedPass?.id === pass.id ? 'active-ticket' : ''}`}
                  onClick={() => setSelectedPass(selectedPass?.id === pass.id ? null : pass)}
                >
                  <div className="pass-ticket-main">
                    <div className="pass-type-badge">{pass.passType}</div>
                    <h4 className="pass-ticket-title">{pass.title}</h4>
                    <p className="pass-ticket-highlight">{pass.highlight}</p>
                    <div className="pass-meta-row">
                      <span className="pass-serial">凭据号: {pass.serialNumber}</span>
                      <span className="pass-date">签发: {pass.issueDate}</span>
                    </div>
                  </div>
                  <div className="pass-ticket-stub">
                    <div className="stub-notch-top"></div>
                    <div className="stub-status-pill">{pass.statusText}</div>
                    <div className="stub-action-tip">{selectedPass?.id === pass.id ? '已展开' : '查看认证'}</div>
                    <div className="stub-notch-bottom"></div>
                  </div>
                </div>
              ))}
            </div>

            {selectedPass && (
              <div className="pass-expanded-credential">
                <div className="credential-box-title"><Icon name="shield" size={15} /> 智能凭证链验真信息</div>
                <div className="credential-row">
                  <span>凭据唯一识别号：</span>
                  <code>{selectedPass.serialNumber}</code>
                </div>
                <div className="credential-row">
                  <span>生效状态：</span>
                  <span className="text-success-green">{selectedPass.statusText} (官方哈希认证)</span>
                </div>
                <button
                  type="button"
                  className="btn-copy-credential"
                  onClick={() => {
                    navigator.clipboard?.writeText(selectedPass.serialNumber);
                    showToast('已复制凭据号到剪贴板');
                  }}
                >
                  复制凭证号
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          弹窗 5：【设置与偏好】（Settings Modal）
         ======================================================== */}
      {activeModal === 'settings' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3 className="modal-title"><Icon name="settings" size={17} className="modal-title-icon" />偏好设置与系统</h3>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            <div className="settings-section-block">
              <div className="settings-section-title">智能体规划偏好引擎</div>

              <div className="setting-toggle-row">
                <div className="setting-toggle-label">
                  <div className="setting-name">0 回头路优先模式</div>
                  <div className="setting-desc">严格审查闭环单向动线，规避折返逆流</div>
                </div>
                <label className="toggle-switch-ui">
                  <input
                    type="checkbox"
                    checked={preferences.zeroTurnaround}
                    onChange={(e) => setPreferences({ ...preferences, zeroTurnaround: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-toggle-row">
                <div className="setting-toggle-label">
                  <div className="setting-name">纯玩无购物严选</div>
                  <div className="setting-desc">过滤一切隐形购物店与商业定点提成</div>
                </div>
                <label className="toggle-switch-ui">
                  <input
                    type="checkbox"
                    checked={preferences.purePlayNoShopping}
                    onChange={(e) => setPreferences({ ...preferences, purePlayNoShopping: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-toggle-row">
                <div className="setting-toggle-label">
                  <div className="setting-name">避挤防堵与错峰预警</div>
                  <div className="setting-desc">优先在非高峰时段排布热门世界遗产地标</div>
                </div>
                <label className="toggle-switch-ui">
                  <input
                    type="checkbox"
                    checked={preferences.antiCrowdAlert}
                    onChange={(e) => setPreferences({ ...preferences, antiCrowdAlert: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div className="settings-section-block">
              <div className="settings-section-title">预算档位倾向</div>
              <div className="budget-level-selector">
                {['经济舒适 (¥3k-5k)', '品质轻奢 (¥5k-10k)', '高端定制 (¥10k+)'].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`budget-lvl-btn ${preferences.budgetLevel === lvl ? 'active' : ''}`}
                    onClick={() => {
                      setPreferences({ ...preferences, budgetLevel: lvl });
                      showToast(`预算档位已更新为「${lvl}」`);
                    }}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section-block">
              <div className="settings-section-title">系统与缓存</div>
              <button type="button" className="btn-clean-cache-action" onClick={handleClearCache}>
                <span><Icon name="trash" size={15} /> 清理本地行程缓存与配置</span>
              </button>
              <div className="app-version-footer">
                旅行智能体 & 行程判官引擎 v2.4.0 (Build 20261115)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          弹窗 6：【编辑个人资料】（Edit Profile Modal）
         ======================================================== */}
      {activeModal === 'editProfile' && (
        <div className="profile-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="profile-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h3 className="modal-title"><Icon name="edit" size={17} className="modal-title-icon" />编辑个人资料</h3>
              <button type="button" className="btn-modal-close" onClick={() => setActiveModal(null)} aria-label="关闭弹窗"><Icon name="close" size={16} /></button>
            </div>

            <div className="edit-profile-form">
              <div className="edit-avatar-group">
                <label className="edit-form-label">选择头像</label>
                <div className="avatar-options-grid">
                  {/* 本机图片：已选时展示为第一个可点选的圆形缩略图 */}
                  <button
                    type="button"
                    className={`avatar-option-pill avatar-upload-pill ${isImageAvatarValue(customAvatar) ? 'active' : ''}`}
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={isReadingAvatarImage}
                    title="从本机选择图片"
                    aria-label="从本机选择头像图片"
                  >
                    {isImageAvatarValue(customAvatar) ? (
                      <img className="avatar-option-image" src={customAvatar} alt="当前头像" />
                    ) : (
                      <Icon name="plus" size={18} />
                    )}
                  </button>
                  {AVATAR_EMOJI_OPTIONS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      className={`avatar-option-pill ${customAvatar === av ? 'active' : ''}`}
                      onClick={() => setCustomAvatar(av)}
                    >
                      {av}
                    </button>
                  ))}
                </div>
                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="avatar-file-input"
                  onChange={handleAvatarFileChange}
                />
                <span className="edit-form-hint">
                  {isReadingAvatarImage ? '正在读取本机图片…' : '点击 + 从本机选择图片，也可以选下面的内置标识'}
                </span>
              </div>

              <div className="edit-field-group">
                <label className="edit-form-label">我的昵称</label>
                <input
                  type="text"
                  value={customNickname}
                  onChange={(e) => setCustomNickname(e.target.value)}
                  placeholder="输入您的旅行家昵称"
                  className="profile-edit-input"
                  maxLength={16}
                />
              </div>

              <button
                type="button"
                className="btn-save-profile-action"
                onClick={() => handleSaveProfile(customNickname, customAvatar)}
              >
                保存并应用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

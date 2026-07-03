import type { Region, RegionId } from '../lib/types';

type MapRegionSwitcherProps = {
  regions: Region[];
  currentRegionId: RegionId;
  onRegionSelect?: (regionId: RegionId) => void;
};

export function MapRegionSwitcher({ regions, currentRegionId, onRegionSelect }: MapRegionSwitcherProps) {
  if (!onRegionSelect || regions.length <= 1) return null;

  const currentRegion = regions.find((region) => region.id === currentRegionId) ?? regions[0];
  const detailRegions = regions.filter((region) => region.id !== 'global');

  return (
    <div className="map-region-switcher" aria-label="지도 위 관심지역 바로 전환">
      <div className="map-region-switcher__topline">
        <span>DETAIL AOI</span>
        <strong>{currentRegion.shortName}</strong>
      </div>
      <label className="map-region-switcher__select">
        <span>세부 지도 조회</span>
        <select
          value={currentRegionId}
          onChange={(event) => onRegionSelect(event.target.value as RegionId)}
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.shortName}
            </option>
          ))}
        </select>
      </label>
      <div className="map-region-switcher__chips" aria-label="주요 지역 빠른 전환">
        {detailRegions.map((region) => (
          <button
            key={region.id}
            type="button"
            className={region.id === currentRegionId ? 'is-active' : undefined}
            onClick={() => onRegionSelect(region.id)}
            aria-pressed={region.id === currentRegionId}
          >
            {region.shortName}
          </button>
        ))}
      </div>
      <p>지도 위 청록 AOI 노드도 클릭하면 바로 전환됩니다.</p>
    </div>
  );
}

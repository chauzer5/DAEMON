import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { DEFAULT_PERSONAS, SQUAD_PRESETS } from "../../config/personas";
import { usePersonaStore } from "../../stores/personaStore";
import { PersonaCard } from "./PersonaCard";
import styles from "./PersonaPicker.module.css";

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function PersonaPicker() {
  const squad = usePersonaStore((s) => s.squad);
  const addToSquad = usePersonaStore((s) => s.addToSquad);
  const removeFromSquad = usePersonaStore((s) => s.removeFromSquad);
  const setSquad = usePersonaStore((s) => s.setSquad);

  return (
    <LayoutGroup>
      <div className={styles.picker}>
        {/* Preset chips */}
        <div className={styles.presets}>
          {SQUAD_PRESETS.map((preset, i) => (
            <motion.button
              key={preset.id}
              className={`${styles.presetChip} ${
                arraysEqual(squad, preset.personas) ? styles.presetChipActive : ""
              }`}
              onClick={() => setSquad(preset.personas)}
              title={preset.description}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 25 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className={styles.presetLabel}>{preset.label}</span>
              <span className={styles.presetCount}>{preset.personas.length}</span>
            </motion.button>
          ))}
        </div>

        <div className={styles.label}>Select Personas</div>
        <motion.div className={styles.grid} layout>
          <AnimatePresence>
            {DEFAULT_PERSONAS.map((persona, i) => (
              <motion.div
                key={persona.id}
                layout
                className={styles.gridCell}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: squad.length > 0 && !squad.includes(persona.id) ? 0.5 : 1,
                  scale: 1,
                }}
                transition={{
                  delay: i * 0.03,
                  type: "spring",
                  stiffness: 300,
                  damping: 25,
                  opacity: { duration: 0.2 },
                }}
              >
                <PersonaCard
                  persona={persona}
                  selected={squad.includes(persona.id)}
                  onClick={() => {
                    if (squad.includes(persona.id)) {
                      removeFromSquad(persona.id);
                    } else {
                      addToSquad(persona.id);
                    }
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </LayoutGroup>
  );
}

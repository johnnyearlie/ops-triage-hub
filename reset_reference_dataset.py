from app.main import db, seed_realistic_incidents_if_empty


def reset_reference_dataset():
    conn = db()

    print("Deleting timeline...")
    conn.execute("DELETE FROM timeline")

    print("Deleting incidents...")
    conn.execute("DELETE FROM incidents")

    conn.commit()
    conn.close()

    print("Seeding reference dataset...")
    seed_realistic_incidents_if_empty()

    print("Done.")
    print("Reference operational dataset restored.")


if __name__ == "__main__":
    reset_reference_dataset()